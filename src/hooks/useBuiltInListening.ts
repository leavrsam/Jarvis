// Built-in listening: "hey Jarvis" detected on the device (openWakeWord), the command recorded
// from the same microphone stream voice ID uses, and transcribed by Deepgram: live while you talk
// (Flux, which also decides when you've finished), or by uploading the recording afterwards
// (/api/transcribe) if live transcription isn't available.
//
// Why: the browser's speech recognizer doesn't exist in Android WebView (Fully Kiosk), and on some
// phones it only gets silence while another stream (voice ID) holds the microphone. This uses one
// shared mic stream for everything. Same interface as useSpeechRecognition, so the app can switch.
import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceCapture } from '../services/speaker/voiceCapture';
import { resampleTo16k } from '../services/speaker/fbank';
import { loadWakeWordModels, WakeWordDetector, WAKE_SAMPLE_RATE } from '../services/wakeword/wakeWordModel';
import { builtInStats, hudMetrics, logEvent } from '../services/eventLog';
import { isLikelyEcho } from '../services/echoMatch';
import { notifyAuthRequired } from '../services/auth';
import { LiveTurn, liveTranscriptionUnavailable, prefetchLiveToken } from '../services/liveTranscriber';
import { getLiveTranscription } from '../services/micSettings';
import { startsWithWakePhrase, stripWakePhrase } from '../services/wakePhrase';
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
/** Live mode: Flux decides the end of a turn; if it hasn't after this much silence, ask it to */
const LIVE_FORCE_END_AFTER_MS = 2000;
/** ...and if it still hasn't answered this long after being asked, upload the recording instead */
const LIVE_GIVE_UP_AFTER_MS = 1500;


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
  /** Give up if nobody starts talking within this long */
  waitMs: number;
  /** Live transcription for this capture (null: upload the recording when it ends) */
  live: LiveTurn | null;
  liveFailed: boolean;
  /** When we asked Flux to end the turn (0: not asked) */
  forcedAt: number;
  /** Flux has heard words in this capture (if not, a noise blip isn't worth uploading) */
  liveHeardWords: boolean;
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
  const liveNoticeRef = useRef('');

  const setState = (state: typeof builtInStats.state) => {
    builtInStats.state = state;
  };

  /** Stop capturing (the capture object stays usable for the transcript that follows) */
  const endCapture = useCallback((cap: CaptureState) => {
    if (captureRef.current === cap) captureRef.current = null;
    cap.live?.close();
  }, []);

  const toStandby = useCallback(() => {
    setState('standby');
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const cancelCapture = useCallback(() => {
    const cap = captureRef.current;
    if (cap) endCapture(cap);
    toStandby();
  }, [endCapture, toStandby]);

  /** Hand a transcript to the app (shared by live and upload paths). False if nothing usable. */
  const deliver = useCallback((cap: CaptureState, raw: string, via: string): boolean => {
    const text = stripWakePhrase(raw);
    const afterSpeechMs = cap.lastSpeechAt ? Date.now() - cap.lastSpeechAt : 0;
    builtInStats.transcriptions++;
    builtInStats.lastTranscriptMs = afterSpeechMs;
    hudMetrics.heardMs = afterSpeechMs;
    hudMetrics.heardVia = via.startsWith('live') ? 'live' : 'uploaded';
    logEvent('heard', `"${raw}" (${via}; text ready ${afterSpeechMs} ms after you stopped)`);
    if (!text) return false;
    const echoRef = live.current.getEchoReference?.(1500) || '';
    if (echoRef && isLikelyEcho(text, echoRef, 0.75)) {
      logEvent('echo-ignored', `"${text}"`);
      return false;
    }
    setTranscript(text);
    // "hey Jarvis" said (or the capture began with it): a fresh request, not a follow-up reply
    live.current.onFinalSubmit?.(text, { wakeWord: cap.kind === 'wake' || startsWithWakePhrase(raw) });
    return true;
  }, []);

  /** Upload the recorded audio and transcribe it (no live transcription, or it failed) */
  const finishWithUpload = useCallback(async (cap: CaptureState) => {
    endCapture(cap);
    if ((!cap.speechStarted || cap.speechMs < 250) && cap.preSpeechMs < PRE_ROLL_COMMAND_SPEECH_MS) {
      logEvent('wake', `Too little speech to transcribe (${Math.round(cap.speechMs)} ms)`);
      toStandby();
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
      deliver(cap, String(data.transcript || '').trim(), 'uploaded');
    } catch (err) {
      builtInStats.lastError = `transcription: ${(err as Error).message}`;
      logEvent('wake', `Transcription error: ${(err as Error).message}`);
    } finally {
      transcribingRef.current = false;
      toStandby();
    }
  }, [deliver, endCapture, toStandby]);

  /** The mic picked up sound but live transcription heard no words: treat it as silence */
  const noWordsHeard = useCallback((cap: CaptureState) => {
    if (captureRef.current !== cap) return;
    const waited = Date.now() - cap.startedAt;
    if (waited < cap.waitMs) {
      // Still inside the window: keep listening for real speech
      cap.speechStarted = false;
      cap.speechMs = 0;
      cap.preSpeechMs = 0;
      cap.forcedAt = 0;
      setInterimTranscript('');
      return;
    }
    logEvent('wake', 'Sound but no words; standing by');
    endCapture(cap);
    toStandby();
    live.current.onFollowUpTimeout?.();
  }, [endCapture, toStandby]);

  const beginCapture = useCallback((kind: CaptureState['kind'], waitMs?: number) => {
    const previous = captureRef.current;
    if (previous) endCapture(previous);
    // Wake captures include the pre-roll (the wake phrase and whatever followed it so far);
    // follow-ups and manual starts just keep the last 300 ms so the first word isn't clipped
    const keepMs = kind === 'wake' ? PRE_ROLL_MS : 300;
    const pre: typeof preRollRef.current = [];
    let ms = 0;
    for (let i = preRollRef.current.length - 1; i >= 0 && ms < keepMs; i--) {
      pre.unshift(preRollRef.current[i]);
      ms += (preRollRef.current[i].audio.length / WAKE_SAMPLE_RATE) * 1000;
    }
    const cap: CaptureState = {
      kind,
      startedAt: Date.now(),
      audio: pre.map((p) => p.audio),
      speechStarted: false,
      lastSpeechAt: 0,
      speechMs: 0,
      preSpeechMs: kind === 'wake' ? pre.reduce((n, p) => n + p.speechMs, 0) : 0,
      waitMs: waitMs ?? (kind === 'follow-up' ? live.current.followUpTimeoutMs : NO_SPEECH_AFTER_WAKE_MS),
      live: null,
      liveFailed: false,
      forcedAt: 0,
      liveHeardWords: false,
    };

    if (getLiveTranscription() && !liveTranscriptionUnavailable()) {
      cap.live = new LiveTurn({
        onUpdate: (t) => {
          if (captureRef.current === cap) {
            cap.liveHeardWords = true;
            setInterimTranscript(stripWakePhrase(t) || '…');
          }
        },
        onEndOfTurn: (t, trigger) => {
          if (captureRef.current !== cap) return;
          if (t) cap.liveHeardWords = true;
          const command = stripWakePhrase(t);
          if (!command) {
            if (trigger === 'manual' && !cap.liveHeardWords) {
              // We asked it to end and it heard no words: a noise blip, not speech
              noWordsHeard(cap);
              return;
            }
            // Only "hey Jarvis" so far (a pause before the command): keep listening for it
            cap.speechStarted = false;
            cap.speechMs = 0;
            cap.preSpeechMs = 0;
            cap.startedAt = Date.now();
            cap.forcedAt = 0;
            setInterimTranscript('');
            return;
          }
          endCapture(cap);
          deliver(cap, t, `live${trigger === 'model' ? '' : `, ${trigger}`}`);
          toStandby();
        },
        onError: (reason) => {
          cap.liveFailed = true;
          const unavailable = liveTranscriptionUnavailable();
          const note = unavailable ? `Live transcription unavailable (${unavailable}); uploading recordings instead` : `Live transcription dropped (${reason}); using the recording`;
          builtInStats.lastError = note;
          if (liveNoticeRef.current !== note) {
            liveNoticeRef.current = note;
            logEvent('wake', note);
          }
        },
      });
      for (const p of pre) cap.live.send(p.audio);
    }

    captureRef.current = cap;
    setState('capturing');
    setIsListening(true);
    setTranscript('');
    setInterimTranscript('');
  }, [deliver, endCapture, finishWithUpload, noWordsHeard, toStandby]);

  // Get a live-transcription token while Jarvis talks, so the follow-up connects instantly
  useEffect(() => {
    if (enabled && isJarvisSpeaking && getLiveTranscription()) void prefetchLiveToken().catch(() => {});
  }, [enabled, isJarvisSpeaking]);

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
    if (getLiveTranscription()) void prefetchLiveToken().catch(() => {});
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
        if (!L.isJarvisSpeaking || cap.kind !== 'follow-up') {
          cap.audio.push(audio);
          if (!cap.liveFailed) cap.live?.send(audio);
        }
        if (chunkHasSpeech) {
          if (!cap.speechStarted) setInterimTranscript((t) => t || '…'); // you're talking: the window stays open
          cap.speechStarted = true;
          cap.lastSpeechAt = now;
          cap.speechMs += chunkMs;
        }
        const useLive = Boolean(cap.live) && !cap.liveFailed;
        // When the user stopped talking (or, for "hey Jarvis, stop" said before detection, when capture began)
        const quietSince = cap.speechStarted
          ? cap.lastSpeechAt
          : cap.preSpeechMs >= PRE_ROLL_COMMAND_SPEECH_MS
            ? cap.startedAt
            : 0;
        const tooLong = now - cap.startedAt > MAX_COMMAND_MS;

        if (!quietSince) {
          if (now - cap.startedAt > cap.waitMs) {
            logEvent('wake', cap.kind === 'follow-up' ? 'Follow-up window closed' : `No command heard (speech before: ${Math.round(cap.preSpeechMs)} ms); standing by`);
            cancelCapture();
            L.onFollowUpTimeout?.();
          }
        } else if (useLive) {
          // Flux decides when the turn is over; nudge it if it's quiet for a while, then give up on it
          const quietFor = now - quietSince;
          if (!cap.forcedAt && (quietFor > LIVE_FORCE_END_AFTER_MS || tooLong)) {
            cap.forcedAt = now;
            cap.live!.forceEndTurn();
          } else if (cap.forcedAt && now - cap.forcedAt > LIVE_GIVE_UP_AFTER_MS) {
            if (cap.live!.isOpen && !cap.liveHeardWords) {
              // Connected and listening, but no words: it was noise (or Jarvis's echo tail)
              noWordsHeard(cap);
            } else {
              cap.liveFailed = true;
              void finishWithUpload(cap);
            }
          }
        } else {
          const endAfter = cap.speechStarted ? END_SILENCE_MS : SHORT_COMMAND_WAIT_MS;
          if (now - quietSince > endAfter || tooLong) void finishWithUpload(cap);
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
        if (transcribingRef.current) return;
        const current = captureRef.current;
        // Already capturing a command; a follow-up window that hasn't heard anything yet gives way
        if (current && (current.kind !== 'follow-up' || current.speechStarted)) return;
        lastWakeRef.current = Date.now();
        builtInStats.detections++;
        if (l.isJarvisSpeaking) {
          logEvent('barge-in', `"hey Jarvis" (score ${score.toFixed(2)})`);
          l.onBargeIn?.('');
          beginCapture('wake');
        } else if (l.wakeWordEnabled || current) {
          logEvent('wake', `"hey Jarvis" detected (score ${score.toFixed(2)})`);
          l.onWakeWordDetected?.('');
          beginCapture('wake');
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      const cap = captureRef.current;
      if (cap) cap.live?.close();
      captureRef.current = null;
      builtInStats.active = false;
    };
  }, [enabled, beginCapture, cancelCapture, finishWithUpload]);

  const startListening = useCallback(
    (isFollowUp = false, timeoutMs?: number) => {
      if (!enabled || transcribingRef.current) return;
      beginCapture(isFollowUp ? 'follow-up' : 'manual', timeoutMs);
    },
    [enabled, beginCapture]
  );

  const stopListening = useCallback(() => {
    const cap = captureRef.current;
    if (!cap) return toStandby();
    if (cap.speechStarted) void finishWithUpload(cap);
    else cancelCapture();
  }, [finishWithUpload, cancelCapture, toStandby]);

  return { isListening, transcript, interimTranscript, startListening, stopListening };
}
