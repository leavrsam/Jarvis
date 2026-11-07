// Built-in listening: "hey Jarvis" detected on the device (openWakeWord), the command recorded
// from the same microphone stream voice ID uses, and transcribed by Deepgram via /api/transcribe.
//
// Why: the browser's speech recognizer doesn't exist in Android WebView (Fully Kiosk), and on some
// phones it only gets silence while another stream (voice ID) holds the microphone. This uses one
// shared mic stream for everything. Same interface as useSpeechRecognition, so the app can switch.
import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceCapture } from '../services/speaker/voiceCapture';
import { resampleTo16k } from '../services/speaker/fbank';
import { loadWakeWordModels, WakeWordDetector, WAKE_SAMPLE_RATE } from '../services/wakeword/wakeWordModel';
import { builtInStats, logEvent } from '../services/eventLog';
import { isLikelyEcho } from '../services/echoMatch';
import { notifyAuthRequired } from '../services/auth';
import type { UseSpeechRecognitionOptions } from './useSpeechRecognition';

/** Trigger level. "Hey Jarvis" scored 0.99-1.00; near-misses like "hey Travis" reached 0.72. */
const WAKE_THRESHOLD = 0.8;
/** While Jarvis is talking, only a very clear "hey Jarvis" interrupts him */
const WAKE_THRESHOLD_WHILE_SPEAKING = 0.9;
const REFRACTORY_MS = 2000;
/** VAD frame. Mic chunks are ~43 ms (2048 samples at 48 kHz), so 10 ms frames give 4 per chunk. */
const FRAME_MS = 10;
/**
 * Audio kept from before a detection. The detector confirms "hey Jarvis" ~1 s after it's said, so
 * a command spoken in the same breath has already started; 2 s covers the wake phrase + that start.
 */
const PRE_ROLL_MS = 2000;
/** Speech in the pre-roll beyond the wake phrase itself (~0.7 s) means a command is in there */
const PRE_ROLL_COMMAND_SPEECH_MS = 1300;
/** If the command was already finished by detection time, transcribe after this much silence */
const SHORT_COMMAND_WAIT_MS = 1200;
const NO_SPEECH_AFTER_WAKE_MS = 6000;
const MAX_COMMAND_MS = 12000;
const END_SILENCE_MS = 900;

const WAKE_PREFIX = /^\s*(?:(?:hey|ok|hi)\s+)?(?:jarvis|travis|jervis)[,.!\s]*/i;

export interface BuiltInListeningOptions extends UseSpeechRecognitionOptions {
  /** Run this engine (the browser engine is used otherwise) */
  enabled: boolean;
  /** Called if the built-in engine can't run here (models or transcription unavailable) */
  onUnavailable?: (reason: string) => void;
}

function encodeWav16k(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, WAKE_SAMPLE_RATE, true);
  view.setUint32(28, WAKE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type CaptureState = {
  kind: 'wake' | 'follow-up' | 'manual';
  startedAt: number;
  audio: Float32Array[];
  speechStarted: boolean;
  lastSpeechAt: number;
  speechMs: number;
  /** Speech already in the pre-roll when capture began */
  preSpeechMs: number;
};

export function useBuiltInListening(opts: BuiltInListeningOptions) {
  const {
    enabled,
    onFinalSubmit,
    onWakeWordDetected,
    onFollowUpTimeout,
    onBargeIn,
    onUnavailable,
    followUpTimeoutMs = 15000,
    isJarvisSpeaking = false,
    wakeWordEnabled = true,
    getEchoReference,
  } = opts;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  // Latest props for the audio callback (which outlives renders)
  const live = useRef({ onFinalSubmit, onWakeWordDetected, onFollowUpTimeout, onBargeIn, onUnavailable, isJarvisSpeaking, wakeWordEnabled, getEchoReference, followUpTimeoutMs });
  live.current = { onFinalSubmit, onWakeWordDetected, onFollowUpTimeout, onBargeIn, onUnavailable, isJarvisSpeaking, wakeWordEnabled, getEchoReference, followUpTimeoutMs };

  const detectorRef = useRef<WakeWordDetector | null>(null);
  const captureRef = useRef<CaptureState | null>(null);
  const preRollRef = useRef<{ audio: Float32Array; speechMs: number }[]>([]);
  const lastWakeRef = useRef(0);
  const noiseFloorRef = useRef(-60);
  const transcribingRef = useRef(false);
  const scoreDecayRef = useRef<{ score: number; at: number }>({ score: 0, at: 0 });

  const setState = (state: typeof builtInStats.state) => {
    builtInStats.state = state;
  };

  const beginCapture = useCallback((kind: CaptureState['kind']) => {
    // Wake captures include the pre-roll (the wake phrase and whatever followed it so far);
    // follow-ups and manual starts just keep the last 300 ms so the first word isn't clipped
    const keepMs = kind === 'wake' ? PRE_ROLL_MS : 300;
    const pre: typeof preRollRef.current = [];
    let ms = 0;
    for (let i = preRollRef.current.length - 1; i >= 0 && ms < keepMs; i--) {
      pre.unshift(preRollRef.current[i]);
      ms += (preRollRef.current[i].audio.length / WAKE_SAMPLE_RATE) * 1000;
    }
    captureRef.current = {
      kind,
      startedAt: Date.now(),
      audio: pre.map((p) => p.audio),
      speechStarted: false,
      lastSpeechAt: 0,
      speechMs: 0,
      preSpeechMs: kind === 'wake' ? pre.reduce((n, p) => n + p.speechMs, 0) : 0,
    };
    setState('capturing');
    setIsListening(true);
    setTranscript('');
    setInterimTranscript('');
  }, []);

  const cancelCapture = useCallback(() => {
    captureRef.current = null;
    setState('standby');
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const finishCapture = useCallback(async () => {
    const cap = captureRef.current;
    captureRef.current = null;
    if (!cap) return;
    if ((!cap.speechStarted || cap.speechMs < 250) && cap.preSpeechMs < PRE_ROLL_COMMAND_SPEECH_MS) {
      logEvent('wake', `Too little speech to transcribe (${Math.round(cap.speechMs)} ms)`);
      setState('standby');
      setIsListening(false);
      setInterimTranscript('');
      return;
    }
    const total = cap.audio.reduce((n, a) => n + a.length, 0);
    const audio = new Float32Array(total);
    let o = 0;
    for (const a of cap.audio) {
      audio.set(a, o);
      o += a.length;
    }
    transcribingRef.current = true;
    setState('transcribing');
    setInterimTranscript('…');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav16k(audio) });
      if (res.status === 401) {
        notifyAuthRequired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        builtInStats.lastError = `transcription: ${data.error || `HTTP ${res.status}`}`;
        logEvent('wake', `Transcription failed: ${data.error || res.status}`);
        if (data.error === 'not_configured') live.current.onUnavailable?.('Speech-to-text is not configured on the server (DEEPGRAM_API_KEY)');
        return;
      }
      builtInStats.transcriptions++;
      builtInStats.lastTranscriptMs = Math.round(performance.now() - t0);
      const raw = String(data.transcript || '').trim();
      const text = raw.replace(WAKE_PREFIX, '').trim();
      logEvent('heard', `"${raw}" (transcribed in ${builtInStats.lastTranscriptMs} ms)`);
      if (!text) return;
      const echoRef = live.current.getEchoReference?.(1500) || '';
      if (echoRef && isLikelyEcho(text, echoRef, 0.75)) {
        logEvent('echo-ignored', `"${text}"`);
        return;
      }
      setTranscript(text);
      live.current.onFinalSubmit?.(text);
    } catch (err) {
      builtInStats.lastError = `transcription: ${(err as Error).message}`;
      logEvent('wake', `Transcription error: ${(err as Error).message}`);
    } finally {
      transcribingRef.current = false;
      setState('standby');
      setIsListening(false);
      setInterimTranscript('');
    }
  }, []);

  // Audio loop: wake word + command capture, on every mic chunk
  useEffect(() => {
    if (!enabled) {
      builtInStats.active = false;
      return;
    }
    builtInStats.active = true;
    let cancelled = false;
    builtInStats.modelStatus = 'loading';
    void voiceCapture.start();
    loadWakeWordModels()
      .then((models) => {
        if (cancelled) return;
        detectorRef.current = new WakeWordDetector(models);
        builtInStats.modelStatus = 'ready';
        logEvent('wake', 'Built-in "hey Jarvis" listener ready');
      })
      .catch((err) => {
        builtInStats.modelStatus = 'error';
        builtInStats.modelError = (err as Error).message;
        logEvent('wake', `Wake word models failed to load: ${(err as Error).message}`);
        live.current.onUnavailable?.(`Wake word models failed to load: ${(err as Error).message}`);
      });

    const frameLen = Math.round((WAKE_SAMPLE_RATE * FRAME_MS) / 1000);
    const unsubscribe = voiceCapture.onAudio((data, rate) => {
      const audio = resampleTo16k(data, rate);
      const now = Date.now();
      const L = live.current;

      // Voice activity per 10 ms frame (adaptive to the room's noise floor)
      let speechFrames = 0;
      for (let f = 0; f + frameLen <= audio.length; f += frameLen) {
        let e = 0;
        for (let i = 0; i < frameLen; i++) e += audio[f + i] * audio[f + i];
        const db = 10 * Math.log10(e / frameLen + 1e-10);
        const isSpeech = db > noiseFloorRef.current + 12 && db > -55;
        if (isSpeech) speechFrames++;
        else noiseFloorRef.current = 0.995 * noiseFloorRef.current + 0.005 * db;
      }
      const chunkMs = (audio.length / WAKE_SAMPLE_RATE) * 1000;
      const chunkHasSpeech = speechFrames >= 2;

      // Pre-roll (audio + how much of it was speech), ~2 s
      preRollRef.current.push({ audio, speechMs: speechFrames * FRAME_MS });
      let preLen = preRollRef.current.reduce((n, a) => n + a.audio.length, 0);
      while (preLen > (WAKE_SAMPLE_RATE * PRE_ROLL_MS) / 1000 && preRollRef.current.length > 1) {
        preLen -= preRollRef.current.shift()!.audio.length;
      }

      // Command capture
      const cap = captureRef.current;
      if (cap) {
        // Don't record Jarvis himself (a reply that starts while we're capturing)
        if (!L.isJarvisSpeaking || cap.kind !== 'follow-up') cap.audio.push(audio);
        if (chunkHasSpeech) {
          cap.speechStarted = true;
          cap.lastSpeechAt = now;
          cap.speechMs += chunkMs;
        }
        const waitLimit = cap.kind === 'follow-up' ? L.followUpTimeoutMs : NO_SPEECH_AFTER_WAKE_MS;
        if (!cap.speechStarted && cap.preSpeechMs >= PRE_ROLL_COMMAND_SPEECH_MS && now - cap.startedAt > SHORT_COMMAND_WAIT_MS) {
          // "Hey Jarvis, stop": the command was over before detection; it's in the pre-roll
          void finishCapture();
        } else if (!cap.speechStarted && now - cap.startedAt > waitLimit) {
          logEvent('wake', `No command heard (speech before: ${Math.round(cap.preSpeechMs)} ms); standing by`);
          cancelCapture();
          L.onFollowUpTimeout?.();
        } else if (cap.speechStarted && (now - cap.lastSpeechAt > END_SILENCE_MS || now - cap.startedAt > MAX_COMMAND_MS)) {
          void finishCapture();
        }
      }

      // Wake word (always fed so its context stays warm)
      const detector = detectorRef.current;
      if (!detector) return;
      void detector.process(audio).then((score) => {
        if (score > scoreDecayRef.current.score || Date.now() - scoreDecayRef.current.at > 2000) {
          scoreDecayRef.current = { score, at: Date.now() };
          builtInStats.recentScore = score;
        }
        const l = live.current;
        const threshold = l.isJarvisSpeaking ? WAKE_THRESHOLD_WHILE_SPEAKING : WAKE_THRESHOLD;
        if (score < threshold || Date.now() - lastWakeRef.current < REFRACTORY_MS) return;
        if (captureRef.current || transcribingRef.current) return; // already listening
        lastWakeRef.current = Date.now();
        builtInStats.detections++;
        if (l.isJarvisSpeaking) {
          logEvent('barge-in', `"hey Jarvis" (score ${score.toFixed(2)})`);
          l.onBargeIn?.('');
          beginCapture('wake');
        } else if (l.wakeWordEnabled) {
          logEvent('wake', `"hey Jarvis" detected (score ${score.toFixed(2)})`);
          l.onWakeWordDetected?.('');
          beginCapture('wake');
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      captureRef.current = null;
      builtInStats.active = false;
    };
  }, [enabled, beginCapture, cancelCapture, finishCapture]);

  const startListening = useCallback(
    (isFollowUp = false) => {
      if (!enabled || transcribingRef.current) return;
      beginCapture(isFollowUp ? 'follow-up' : 'manual');
    },
    [enabled, beginCapture]
  );

  const stopListening = useCallback(() => {
    const cap = captureRef.current;
    if (cap?.speechStarted) void finishCapture();
    else cancelCapture();
  }, [finishCapture, cancelCapture]);

  return { isListening, transcript, interimTranscript, startListening, stopListening };
}
