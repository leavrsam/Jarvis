// Singleton Web Audio API & Gemini 3.8 Expressive TTS Engine for J.A.R.V.I.S.
import { voiceBiometrics } from './voiceBiometrics';
import { voiceCapture } from './speaker/voiceCapture';
import { micConstraints } from './micSettings';
import { stripPauseTags } from './replyStream';
import { notifyAuthRequired } from './auth';

export type JarvisAudioState = 'idle' | 'listening' | 'processing' | 'speaking';

/** Sentence-by-sentence speech for a reply that is still streaming in. */
export interface SpeechQueue {
  /** Add a sentence. Synthesis starts immediately; playback is in order, back-to-back. */
  enqueue(text: string): void;
  /** No more sentences will be added. */
  finish(): void;
  /** Resolves once everything has played, or the queue was stopped. */
  readonly done: Promise<void>;
}

/** One TTS request's worth of speech, started immediately and played when its turn comes. */
interface SpeechClip {
  text: string;
  /** Settles once the audio has fully downloaded (or failed) */
  downloaded: Promise<void>;
  /** Plays the clip; resolves when it has finished (or the reply was stopped) */
  play(onStart: () => void): Promise<void>;
}

export interface JarvisNeuralVoicePreset {
  id: string;
  name: string;
  shortLabel: string;
  provider: 'gemini' | 'edge';
  model: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' | 'edge-24khz';
  voice: string;
  edgeVoice: string;
  accent: string;
  description: string;
  style: string;
  rate: string;
  pitch: string;
  hudDsp: boolean;
}

export const JARVIS_NEURAL_VOICES: JarvisNeuralVoicePreset[] = [
  {
    id: 'gemini-jarvis-designed',
    name: 'J.A.R.V.I.S. Mk-VII (Gemini 3.8 • Custom Voice Design)',
    shortLabel: 'Gemini 3.8 Jarvis',
    provider: 'gemini',
    model: 'gemini-3.8-flash-tts',
    voice: 'AUTO_DESIGN_JARVIS',
    edgeVoice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Custom Designed AI Butler',
    description:
      'Gemini 3.8 Flash TTS with your custom-designed British AI butler voice. Tune it in the Voice Lab.',
    // Kept deliberately short: Google's TTS guide says long per-line direction causes voice drift.
    // Identity (age, timbre, accent) lives in the designed voice itself.
    style: 'calm, precise, dryly understated',
    rate: '+0%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    // Same designed voice and style on the faster, cheaper model, for comparing by ear
    id: 'gemini-jarvis-designed-lite',
    name: 'J.A.R.V.I.S. Mk-VII Lite (Gemini 3.8 Flash-Lite • Custom Voice Design)',
    shortLabel: 'Gemini 3.8 Jarvis Lite',
    provider: 'gemini',
    model: 'gemini-3.8-flash-lite-tts',
    voice: 'AUTO_DESIGN_JARVIS',
    edgeVoice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Custom Designed AI Butler',
    description:
      'Your designed Jarvis voice on Gemini 3.8 Flash-Lite TTS: built for low latency; may be slightly less nuanced than Flash.',
    style: 'calm, precise, dryly understated',
    rate: '+0%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'edge-ryan-mk7',
    name: 'Edge Neural Backup (Ryan Neural • Free Fallback)',
    shortLabel: 'Ryan Neural (Edge)',
    provider: 'edge',
    model: 'edge-24khz',
    voice: 'en-GB-RyanNeural',
    edgeVoice: 'en-GB-RyanNeural',
    accent: 'en-GB • Microsoft 24kHz Neural',
    description:
      'Zero-cost 24kHz Microsoft Ryan Neural voice (also used automatically if GEMINI_API_KEY is not set).',
    style: 'standard',
    rate: '+4%',
    pitch: '-2Hz',
    hudDsp: true,
  },
];

export interface JarvisVoiceTuning {
  /** Acting direction sent with every line. Empty = use the preset's style. */
  style: string;
  /** Low-mid chest resonance around 190 Hz, in dB */
  warmthDb: number;
  /** Consonant crispness around 3.6 kHz, in dB */
  presenceDb: number;
  /** Level of the short "suit intercom" reflection, 0-0.3 */
  intercomWet: number;
}

export const DEFAULT_VOICE_TUNING: JarvisVoiceTuning = {
  style: '',
  warmthDb: 2.2,
  presenceDb: 2.4,
  intercomWet: 0.08,
};

/**
 * "Mk-VIII" refinement of the original designed voice (voice_5r8hqutci8lm), built per Google's
 * voice-remixing guidance: start from the existing voice, change one or two traits per step,
 * and explicitly preserve speaker identity and accent.
 */
export const REFINED_JARVIS_RECIPE = {
  baseVoice: 'voice_5r8hqutci8lm',
  steps: [
    // Step 1, timbre: the original prompt asked for a "warm, resonant baritone" with "subtle breathiness",
    // which reads as an older audiobook narrator. The target is lighter, cleaner and more precise.
    'Keep the same speaker identity and English Received Pronunciation accent, but make the timbre lighter and cleaner: a clear, light baritone rather than deep and resonant, slightly younger-sounding, with no breathiness or gravel.',
    // Step 2, delivery baseline: precise articulation, close mic, quick but unhurried.
    'Keep the same speaker identity and accent, but make the delivery crisp and precise with slightly clipped consonants, softly projected as if close to the microphone, with a quick, even, unhurried pace and an air of calm, dry composure.',
  ],
  tuning: {
    style: '',
    // A lighter voice needs less low-mid boost; the old +2.2 dB pushed it back toward "radio baritone".
    warmthDb: 0.5,
    presenceDb: 2.5,
    intercomWet: 0.1,
  },
} as const;

export interface SpeechDiagnostic {
  text: string;
  engine: string;
  ms: number;
  note: string;
  fallback: boolean;
}

// Gemini TTS request policy: per-sentence requests, two at a time, one retry in the same voice.
const MAX_GEMINI_IN_FLIGHT = 2;
const GEMINI_ATTEMPTS = 2;
const GEMINI_SERVER_TIMEOUT_MS = 15000;

// Short holding phrases, pre-synthesized so they play with zero latency
// Kept few: each is a Gemini request the first time (then saved on the device), and the TTS
// rate limit is shared with real replies.
const ACK_PHRASES_OWNER = ['One moment, sir.', 'Working on it, sir.'];
const ACK_PHRASES_GUEST = ['One moment, please.'];

class JarvisAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  /** False when micStream is voice ID's shared stream (not ours to stop) */
  private micStreamOwned = true;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // Active Neural TTS playback nodes
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private activeAbortController: AbortController | null = null;
  private audioBufferCache: Map<string, AudioBuffer> = new Map();

  // Fallback TTS synthesis nodes (only used if completely offline)
  private ttsOscillator: OscillatorNode | null = null;
  private ttsGain: GainNode | null = null;
  private ttsFilter: BiquadFilterNode | null = null;
  private isTtsActive = false;
  private ttsSpeechAnimId: number | null = null;

  // Background Audio Keep-Alive
  private keepAliveOsc: OscillatorNode | null = null;

  // Analyser buffers
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  // State
  private currentState: JarvisAudioState = 'idle';
  private selectedPreset: JarvisNeuralVoicePreset = JARVIS_NEURAL_VOICES[0];
  private customDesignedVoiceId: string = 'voice_5r8hqutci8lm';
  private clientGeminiApiKey: string = '';
  private lastActiveEngine: string = 'gemini-3.8-flash-tts';

  // Instant acknowledgement ("One moment, sir.") played while the n8n agent works
  private ackBuffers: Map<string, AudioBuffer> = new Map();
  private ackPreloadPromise: Promise<void> | null = null;
  private ackPromise: Promise<void> | null = null;
  private lastAckPhrase = '';
  private lastPrewarmAt = 0;

  // Gemini request throttling + diagnostics
  private geminiInFlight = 0;
  private geminiWaiters: (() => void)[] = [];
  private geminiHighWaiting = 0;
  private speechDiagnostics: SpeechDiagnostic[] = [];
  // Streaming TTS (on by default; Voice Lab toggle)
  private streamingEnabled = (() => {
    try {
      return localStorage.getItem('jarvis_tts_streaming') !== 'off';
    } catch {
      return true;
    }
  })();
  private streamSources = new Set<AudioBufferSourceNode>();

  // Voice Lab tuning (persisted per device)
  private voiceTuning: JarvisVoiceTuning = { ...DEFAULT_VOICE_TUNING };
  private voiceHistory: string[] = [];
  private voiceLabels: Record<string, string> = { [REFINED_JARVIS_RECIPE.baseVoice]: 'Original Mk-VII' };

  constructor() {
    this.initVoicePreset();
  }

  private initVoicePreset() {
    try {
      const savedId = localStorage.getItem('jarvis_neural_voice_id');
      if (savedId) {
        const found = JARVIS_NEURAL_VOICES.find((p) => p.id === savedId);
        if (found) {
          this.selectedPreset = found;
        }
      }
      const savedCustomVoiceId = localStorage.getItem('jarvis_custom_designed_voice_id');
      if (savedCustomVoiceId && savedCustomVoiceId !== 'voice_g67uthl21vr5') {
        this.customDesignedVoiceId = savedCustomVoiceId;
      } else if (savedCustomVoiceId === 'voice_g67uthl21vr5') {
        localStorage.removeItem('jarvis_custom_designed_voice_id');
        this.customDesignedVoiceId = '';
      }
      const savedTuning = localStorage.getItem('jarvis_voice_tuning');
      if (savedTuning) {
        this.voiceTuning = { ...DEFAULT_VOICE_TUNING, ...JSON.parse(savedTuning) };
      }
      const savedLabels = localStorage.getItem('jarvis_voice_labels');
      if (savedLabels) {
        this.voiceLabels = { ...this.voiceLabels, ...JSON.parse(savedLabels) };
      }
      const savedHistory = localStorage.getItem('jarvis_voice_history');
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) this.voiceHistory = parsed.filter((v) => typeof v === 'string');
      }
      const savedKey = localStorage.getItem('jarvis_gemini_api_key');
      if (savedKey) {
        this.clientGeminiApiKey = savedKey;
      }
    } catch {}
  }

  public getVoicePreset(): JarvisNeuralVoicePreset {
    return this.selectedPreset;
  }

  public getNeuralVoices(): JarvisNeuralVoicePreset[] {
    return JARVIS_NEURAL_VOICES;
  }

  public setVoicePreset(presetId: string): JarvisNeuralVoicePreset {
    const found = JARVIS_NEURAL_VOICES.find((p) => p.id === presetId) || JARVIS_NEURAL_VOICES[0];
    if (found.model !== this.selectedPreset.model) this.ackBuffers.clear(); // acks are per model
    this.selectedPreset = found;
    try {
      localStorage.setItem('jarvis_neural_voice_id', found.id);
    } catch {}
    return found;
  }

  public getVoiceName(): string {
    return this.selectedPreset.shortLabel;
  }

  public getLastActiveEngine(): string {
    return this.lastActiveEngine;
  }

  public getCustomDesignedVoiceId(): string {
    return this.customDesignedVoiceId;
  }

  public setCustomDesignedVoiceId(voiceId: string) {
    this.customDesignedVoiceId = voiceId.trim();
    this.resetAcknowledgements();
    this.audioBufferCache.clear();
    try {
      if (this.customDesignedVoiceId) {
        localStorage.setItem('jarvis_custom_designed_voice_id', this.customDesignedVoiceId);
      } else {
        localStorage.removeItem('jarvis_custom_designed_voice_id');
      }
    } catch {}
  }

  public getClientGeminiApiKey(): string {
    return this.clientGeminiApiKey;
  }

  public setClientGeminiApiKey(key: string) {
    this.clientGeminiApiKey = key.trim();
    this.audioBufferCache.clear();
    try {
      if (this.clientGeminiApiKey) {
        localStorage.setItem('jarvis_gemini_api_key', this.clientGeminiApiKey);
      } else {
        localStorage.removeItem('jarvis_gemini_api_key');
      }
    } catch {}
  }

  public async checkServerGeminiStatus(): Promise<{
    geminiConfigured: boolean;
    cachedDesignedVoiceId: string | null;
  }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.clientGeminiApiKey) {
        headers['x-gemini-api-key'] = this.clientGeminiApiKey;
      }
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'status' }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return { geminiConfigured: Boolean(this.clientGeminiApiKey), cachedDesignedVoiceId: null };
  }

  /**
   * Create a new designed voice. With baseVoice, the prompt describes changes relative to that voice
   * ("a touch lighter and quicker"); without it, the prompt describes the whole voice.
   */
  public async designCustomJarvisVoice(
    prompt?: string,
    baseVoice?: string,
    label?: string
  ): Promise<string | null> {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: this.buildTtsHeaders(),
      body: JSON.stringify({
        action: 'design_voice',
        prompt,
        baseVoice,
      }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.details || errJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.voiceId) {
      if (this.customDesignedVoiceId) this.rememberVoice(this.customDesignedVoiceId);
      this.rememberVoice(data.voiceId);
      if (label) this.setVoiceLabel(data.voiceId, label);
      this.setCustomDesignedVoiceId(data.voiceId);
      return data.voiceId;
    }
    return null;
  }

  private rememberVoice(voiceId: string) {
    this.voiceHistory = [voiceId, ...this.voiceHistory.filter((v) => v !== voiceId)].slice(0, 10);
    try {
      localStorage.setItem('jarvis_voice_history', JSON.stringify(this.voiceHistory));
    } catch {}
  }

  /** Recently designed voice ids, newest first (original always included), so you can A/B and revert. */
  public getVoiceHistory(): string[] {
    const all = [
      ...(this.customDesignedVoiceId ? [this.customDesignedVoiceId] : []),
      ...this.voiceHistory,
      REFINED_JARVIS_RECIPE.baseVoice,
    ];
    return Array.from(new Set(all));
  }

  public getVoiceLabel(voiceId: string): string {
    return this.voiceLabels[voiceId] || voiceId;
  }

  private setVoiceLabel(voiceId: string, label: string) {
    this.voiceLabels[voiceId] = label;
    try {
      localStorage.setItem('jarvis_voice_labels', JSON.stringify(this.voiceLabels));
    } catch {}
  }

  /** Drop pre-synthesized "One moment, sir." clips so they're re-made in the current voice. */
  private resetAcknowledgements() {
    // Re-synthesized lazily on the next wake word (prewarm), so intermediate voices don't cost extra calls.
    this.ackBuffers.clear();
    this.ackPreloadPromise = null;
  }

  /**
   * Build the refined "Mk-VIII" voice by chaining remixes from the original designed voice,
   * then apply its matching EQ. Each intermediate voice is kept in history for A/B comparison.
   */
  public async createRefinedJarvisVoice(onProgress?: (msg: string) => void): Promise<string> {
    let base: string = REFINED_JARVIS_RECIPE.baseVoice;
    const total = REFINED_JARVIS_RECIPE.steps.length;
    for (let i = 0; i < total; i++) {
      onProgress?.(`Step ${i + 1} of ${total}: ${i === 0 ? 'refining timbre' : 'refining delivery'}...`);
      const label = i === total - 1 ? 'Refined Mk-VIII' : `Mk-VIII step ${i + 1} (timbre only)`;
      const id = await this.designCustomJarvisVoice(REFINED_JARVIS_RECIPE.steps[i], base, label);
      if (!id) throw new Error(`Voice Design returned no voice at step ${i + 1}`);
      base = id;
    }
    this.setVoiceTuning({ ...REFINED_JARVIS_RECIPE.tuning });
    return base;
  }

  public getVoiceTuning(): JarvisVoiceTuning {
    return { ...this.voiceTuning };
  }

  public setVoiceTuning(patch: Partial<JarvisVoiceTuning>): JarvisVoiceTuning {
    if (patch.style !== undefined && patch.style !== this.voiceTuning.style) {
      this.resetAcknowledgements();
    }
    this.voiceTuning = { ...this.voiceTuning, ...patch };
    try {
      localStorage.setItem('jarvis_voice_tuning', JSON.stringify(this.voiceTuning));
    } catch {}
    return this.getVoiceTuning();
  }

  public resetVoiceTuning(): JarvisVoiceTuning {
    this.voiceTuning = { ...DEFAULT_VOICE_TUNING };
    try {
      localStorage.removeItem('jarvis_voice_tuning');
    } catch {}
    return this.getVoiceTuning();
  }

  private getEffectiveStyle(): string {
    return this.voiceTuning.style.trim() || this.selectedPreset.style;
  }

  /** Reset the playback output before the next sound (see resetOutput), once this time has passed */
  private outputResetAt = 0;

  /**
   * The mic was just closed (Android call-mode workaround): the next sound, from `delayMs` on,
   * opens a fresh output. The delay gives Android time to leave call mode.
   */
  public scheduleOutputReset(delayMs = 250) {
    this.outputResetAt = Date.now() + delayMs;
  }

  public cancelOutputReset() {
    this.outputResetAt = 0;
  }

  public ensureContext(): AudioContext {
    if (this.outputResetAt) {
      // Before the delay something already needs the current output (e.g. a reply clip that
      // started very fast): keep it, rather than close it under that sound
      if (Date.now() >= this.outputResetAt && this.resetOutput()) {
        console.info('[JarvisAudioEngine] Playback output reopened after the mic closed');
      }
      this.outputResetAt = 0;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    this.ensureKeepAlive();
    return this.ctx;
  }

  private ensureKeepAlive() {
    if (!this.ctx || this.keepAliveOsc) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(5, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.00001, this.ctx.currentTime);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.keepAliveOsc = osc;
    } catch {}
  }

  /**
   * Drop the playback context so the next sound opens a fresh one. On Android, Chrome sets up
   * an audio output for "call" or "media" depending on whether a mic is open at that moment, and
   * keeps it that way. After the mic is closed, a fresh context plays as media (through the TV
   * on DeX). Skipped while Jarvis is speaking.
   */
  public resetOutput(): boolean {
    if (!this.ctx) return false;
    if (this.speechLog.some((e) => e.endedAt === null) || this.activeSourceNode || this.isTtsActive) return false;
    const old = this.ctx;
    try {
      this.micSource?.disconnect();
    } catch {}
    this.micSource = null;
    this.keepAliveOsc = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.ctx = null;
    void old.close().catch(() => {});
    return true;
  }

  public getAnalyser(): AnalyserNode | null {
    this.ensureContext();
    return this.analyser;
  }

  public getState(): JarvisAudioState {
    return this.currentState;
  }

  public setState(state: JarvisAudioState) {
    this.currentState = state;
  }

  public async startMicListening(): Promise<boolean> {
    try {
      this.ensureContext();
      if (!this.analyser) return false;

      // The shared stream was reopened (e.g. mic settings changed): follow the new one
      if (this.micStream && !this.micStreamOwned && this.micStream !== voiceCapture.getStream()) {
        try {
          this.micSource?.disconnect();
        } catch {}
        this.micSource = null;
        this.micStream = null;
      }
      if (!this.micStream) {
        // Reuse the voice ID / wake word stream when it's open: a second mic stream can starve
        // the first on some phones, and on Android may switch audio into call mode (phone speaker)
        const shared = voiceCapture.getStream();
        if (shared) {
          this.micStream = shared;
          this.micStreamOwned = false;
        } else {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
          this.micStreamOwned = true;
        }
      }

      if (this.ctx && this.micStream && !this.micSource) {
        this.micSource = this.ctx.createMediaStreamSource(this.micStream);
        this.micSource.connect(this.analyser);
      }

      this.currentState = 'listening';
      return true;
    } catch (err) {
      console.warn('[JarvisAudioEngine] Microphone access denied or unavailable:', err);
      return false;
    }
  }

  public stopMicListening() {
    if (this.micSource && this.analyser) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }
    if (this.micStream) {
      if (this.micStreamOwned) this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.currentState === 'listening') {
      this.currentState = 'idle';
    }
  }

  private cleanSpeechText(raw: string): string {
    return raw
      .replace(/PLAY_YOUTUBE(?:_PLAYLIST)?:\s*\[?[a-zA-Z0-9_-]+\]?/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[*_#`~[\]]/g, '')
      .replace(/J\.A\.R\.V\.I\.S\./gi, 'Jarvis')
      .replace(/F\.R\.I\.D\.A\.Y\./gi, 'Friday')
      .replace(/n8n/gi, 'N-8-N')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build the Christopher Boyes / Iron Man Movie J.A.R.V.I.S. Vocal Mastering Chain.
   */
  private connectJarvisVocalChain(source: AudioNode, enableHudDsp: boolean) {
    if (!this.ctx || !this.analyser) return;

    if (!enableHudDsp) {
      source.connect(this.analyser);
      source.connect(this.ctx.destination);
      return;
    }

    const highPass = this.ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(80, this.ctx.currentTime);
    highPass.Q.setValueAtTime(0.7, this.ctx.currentTime);

    const chestWarmth = this.ctx.createBiquadFilter();
    chestWarmth.type = 'peaking';
    chestWarmth.frequency.setValueAtTime(190, this.ctx.currentTime);
    chestWarmth.gain.setValueAtTime(this.voiceTuning.warmthDb, this.ctx.currentTime);
    chestWarmth.Q.setValueAtTime(1.1, this.ctx.currentTime);

    const clarityCut = this.ctx.createBiquadFilter();
    clarityCut.type = 'peaking';
    clarityCut.frequency.setValueAtTime(480, this.ctx.currentTime);
    clarityCut.gain.setValueAtTime(-1.5, this.ctx.currentTime);
    clarityCut.Q.setValueAtTime(1.4, this.ctx.currentTime);

    const presenceBoost = this.ctx.createBiquadFilter();
    presenceBoost.type = 'peaking';
    presenceBoost.frequency.setValueAtTime(3650, this.ctx.currentTime);
    presenceBoost.gain.setValueAtTime(this.voiceTuning.presenceDb, this.ctx.currentTime);
    presenceBoost.Q.setValueAtTime(1.2, this.ctx.currentTime);

    const airShelf = this.ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.setValueAtTime(9200, this.ctx.currentTime);
    airShelf.gain.setValueAtTime(1.6, this.ctx.currentTime);

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, this.ctx.currentTime);
    compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(3.0, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    const dryGain = this.ctx.createGain();
    dryGain.gain.setValueAtTime(0.96, this.ctx.currentTime);

    const hudDelay = this.ctx.createDelay(0.05);
    hudDelay.delayTime.setValueAtTime(0.011, this.ctx.currentTime);

    const wetFilter = this.ctx.createBiquadFilter();
    wetFilter.type = 'bandpass';
    wetFilter.frequency.setValueAtTime(1800, this.ctx.currentTime);
    wetFilter.Q.setValueAtTime(0.9, this.ctx.currentTime);

    const wetGain = this.ctx.createGain();
    wetGain.gain.setValueAtTime(this.voiceTuning.intercomWet, this.ctx.currentTime);

    const masterOut = this.ctx.createGain();
    masterOut.gain.setValueAtTime(1.06, this.ctx.currentTime);

    source.connect(highPass);
    highPass.connect(chestWarmth);
    chestWarmth.connect(clarityCut);
    clarityCut.connect(presenceBoost);
    presenceBoost.connect(airShelf);
    airShelf.connect(compressor);

    compressor.connect(dryGain);
    dryGain.connect(masterOut);

    compressor.connect(hudDelay);
    hudDelay.connect(wetFilter);
    wetFilter.connect(wetGain);
    wetGain.connect(masterOut);

    masterOut.connect(this.analyser);
    masterOut.connect(this.ctx.destination);
  }

  /**
   * Split a reply into sentence-sized chunks so the first sentence can be
   * synthesized and played while the rest is still being generated.
   * The first chunk is kept short for the fastest possible time-to-first-audio.
   */
  private splitIntoSpeechChunks(text: string, groupLimit = 120): string[] {
    // Break only where a sentence end is followed by a new sentence (keeps "6 p.m., so" intact)
    const sentences = text.split(/(?<=[.!?]["')\]]*)\s+(?=[A-Z0-9"'(<])/).map((s) => s.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      // First chunk: one sentence, for fast first audio. Later: merge only short sentences (~120 chars),
      // since smaller Gemini requests come back much faster (Google's TTS guide recommends short turns).
      const limit = chunks.length === 0 ? 0 : groupLimit;
      if (current && (current.length + sentence.length + 1 > limit)) {
        chunks.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private buildTtsHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.clientGeminiApiKey) {
      headers['x-gemini-api-key'] = this.clientGeminiApiKey;
    }
    return headers;
  }

  /**
   * Run Gemini TTS requests at most MAX_GEMINI_IN_FLIGHT at a time. Sentences play in order anyway,
   * so firing every sentence at once only invites rate limiting and slows the first ones down.
   */
  private async withGeminiSlot<T>(task: () => Promise<T>, priority: 'high' | 'low' = 'high'): Promise<T> {
    // Low priority (pre-making "One moment, sir" clips) never takes the last free slot and always
    // yields to waiting speech, so it can't delay what Jarvis is actually saying.
    const canRun = () =>
      priority === 'high'
        ? this.geminiInFlight < MAX_GEMINI_IN_FLIGHT
        : this.geminiInFlight < MAX_GEMINI_IN_FLIGHT - 1 && this.geminiHighWaiting === 0;
    if (priority === 'high') this.geminiHighWaiting++;
    try {
      while (!canRun()) {
        await new Promise<void>((resolve) => this.geminiWaiters.push(resolve));
      }
    } finally {
      if (priority === 'high') this.geminiHighWaiting--;
    }
    this.geminiInFlight++;
    try {
      return await task();
    } finally {
      this.geminiInFlight--;
      // Wake everyone; each re-checks its own condition
      const waiters = this.geminiWaiters.splice(0);
      waiters.forEach((w) => w());
    }
  }

  private async requestTts(
    body: Record<string, unknown>,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<{ response: Response | null; timedOut: boolean; error: string; status: number }> {
    const timeoutController = new AbortController();
    const onOuterAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onOuterAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: this.buildTtsHeaders(),
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });
      if (response.status === 401) notifyAuthRequired();
      if (!response.ok) {
        const reason =
          response.headers.get('X-TTS-Error') ||
          (await response.json().catch(() => ({})))?.details ||
          `HTTP ${response.status}`;
        return { response: null, timedOut: false, error: String(reason), status: response.status };
      }
      return { response, timedOut: false, error: '', status: response.status };
    } catch (err) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return {
        response: null,
        timedOut,
        error: timedOut ? `no audio after ${Math.round(timeoutMs / 1000)}s` : String(err),
        status: 0,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onOuterAbort);
    }
  }

  private recordSpeechDiagnostic(entry: SpeechDiagnostic) {
    this.speechDiagnostics = [entry, ...this.speechDiagnostics].slice(0, 12);
  }

  /** Per-sentence log of recent TTS requests: which engine spoke it, how long it took, and why. */
  public getSpeechDiagnostics(): SpeechDiagnostic[] {
    return [...this.speechDiagnostics];
  }

  /**
   * Fetch + decode one chunk of speech in the designed Gemini voice. Gemini failures are retried
   * once in the same voice; only then does the sentence fall back to the Edge voice, so a reply
   * doesn't switch voices because of one transient error. Fallback audio is never cached.
   */
  private async fetchSpeechBuffer(
    spokenText: string,
    signal: AbortSignal,
    priority: 'high' | 'low' = 'high'
  ): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const preset = this.selectedPreset;
    const effectiveVoice =
      preset.voice === 'AUTO_DESIGN_JARVIS' && this.customDesignedVoiceId
        ? this.customDesignedVoiceId
        : preset.voice;
    const style = this.getEffectiveStyle();
    const cacheKey = `${preset.id}::${effectiveVoice}::${style}::${spokenText}`;

    const cached = this.audioBufferCache.get(cacheKey);
    if (cached) return cached;

    const baseBody = {
      text: spokenText,
      model: preset.model,
      voice: effectiveVoice,
      edgeVoice: preset.edgeVoice,
      style,
      rate: preset.rate,
      pitch: preset.pitch,
    };
    const startedAt = performance.now();
    const label = spokenText.length > 48 ? `${spokenText.slice(0, 45)}...` : spokenText;
    const notes: string[] = [];

    const decode = async (response: Response) => {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 256) throw new Error('Invalid audio buffer received');
      return ctx.decodeAudioData(arrayBuffer.slice(0));
    };

    if (preset.provider !== 'edge') {
      for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt++) {
        const queuedAt = performance.now();
        let sentAt = queuedAt;
        const result = await this.withGeminiSlot(() => {
          sentAt = performance.now();
          return this.requestTts(
            { ...baseBody, provider: preset.provider, fallback: false, geminiTimeoutMs: GEMINI_SERVER_TIMEOUT_MS },
            signal,
            GEMINI_SERVER_TIMEOUT_MS + 3000
          );
        }, priority);
        const waitedMs = Math.round(sentAt - queuedAt);
        if (waitedMs > 300) notes.push(`queued ${(waitedMs / 1000).toFixed(1)}s`);
        if (result.response) {
          const engine = result.response.headers.get('X-TTS-Engine') || preset.model;
          this.lastActiveEngine = engine;
          const resolvedVoice = result.response.headers.get('X-Gemini-Voice-Id');
          if (resolvedVoice?.startsWith('voice_') && !this.customDesignedVoiceId) {
            this.setCustomDesignedVoiceId(resolvedVoice);
          }
          try {
            const audioBuffer = await decode(result.response);
            if (this.audioBufferCache.size > 35) {
              const oldestKey = this.audioBufferCache.keys().next().value;
              if (oldestKey) this.audioBufferCache.delete(oldestKey);
            }
            this.audioBufferCache.set(cacheKey, audioBuffer);
            const serverMs = Number(result.response.headers.get('X-TTS-Duration-Ms')) || 0;
            const path = result.response.headers.get('X-TTS-Path') || '';
            const detail = [
              ...notes,
              serverMs ? `server ${(serverMs / 1000).toFixed(1)}s` : '',
              path,
              attempt > 1 ? 'succeeded on retry' : '',
            ].filter(Boolean);
            this.recordSpeechDiagnostic({
              text: label,
              engine,
              ms: Math.round(performance.now() - startedAt),
              note: detail.join('; '),
              fallback: false,
            });
            return audioBuffer;
          } catch (err) {
            notes.push(`attempt ${attempt}: ${String(err)}`);
          }
        } else {
          notes.push(`attempt ${attempt}: ${result.error}`);
          // A slow Gemini won't get faster on an immediate retry; don't double the wait.
          if (result.timedOut || result.status === 504 || /timed out/i.test(result.error)) break;
        }
        // Rate limited: back off a little longer before the single retry
        if (attempt < GEMINI_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, result.status === 429 ? 1500 : 400));
        }
      }
    }

    // Edge voice: intended (Edge preset) or last resort after Gemini failed
    const edge = await this.requestTts({ ...baseBody, provider: 'edge' }, signal, 8000);
    if (!edge.response) {
      this.recordSpeechDiagnostic({
        text: label,
        engine: 'no audio (all engines failed)',
        ms: Math.round(performance.now() - startedAt),
        note: [...notes, `edge: ${edge.error}`].join('; '),
        fallback: true,
      });
      throw new Error(`All TTS engines failed: ${[...notes, edge.error].join('; ')}`);
    }
    const audioBuffer = await decode(edge.response);
    const isFallback = preset.provider !== 'edge';
    this.lastActiveEngine = isFallback ? 'edge-neural-fallback' : 'edge';
    if (!isFallback) this.audioBufferCache.set(cacheKey, audioBuffer);
    this.recordSpeechDiagnostic({
      text: label,
      engine: isFallback ? 'Edge backup voice' : 'Edge',
      ms: Math.round(performance.now() - startedAt),
      note: notes.join('; '),
      fallback: isFallback,
    });
    return audioBuffer;
  }

  // -------------------------------------------------------------------------
  // Speech clips: one TTS request each. With streaming on, a Gemini clip starts playing at its
  // first audio chunk while the rest is still being generated, and replies are sent as fewer,
  // larger requests (first sentence alone, the rest grouped), which matters at 10 requests/min.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Speech log for the microphone echo filter: everything Jarvis is saying or said in the last
  // few seconds (holding phrases, reply sentences, fallback voices). Speech recognition can
  // deliver words up to a second or two after they were heard, so the tail matters.
  // -------------------------------------------------------------------------
  private speechLog: { text: string; startedAt: number; endedAt: number | null }[] = [];

  /** Record that `text` is being spoken; call the returned function when it stops. */
  private noteSpeech(text: string): () => void {
    const entry = { text, startedAt: Date.now(), endedAt: null as number | null };
    this.speechLog.push(entry);
    if (this.speechLog.length > 30) this.speechLog.splice(0, this.speechLog.length - 30);
    return () => {
      if (entry.endedAt === null) entry.endedAt = Date.now();
    };
  }

  /**
   * When Jarvis was audible (speech log entries), padded with a short tail for room echo and
   * output latency. Voice ID leaves these stretches out of the user's captured audio.
   */
  public getJarvisIntervals(tailMs = 700): { start: number; end: number }[] {
    const now = Date.now();
    return this.speechLog.map((e) => ({
      start: e.startedAt - 100,
      end: (e.endedAt ?? now + 60_000) + tailMs,
    }));
  }

  /**
   * Text Jarvis is speaking now or finished speaking within `tailMs`. The recognizer discards
   * anything that matches it, so Jarvis doesn't hear himself and treat it as a command.
   */
  public getEchoReference(tailMs = 4000): string {
    const now = Date.now();
    return this.speechLog
      .filter((e) =>
        e.endedAt === null ? now - e.startedAt < 60_000 : now - e.endedAt < tailMs
      )
      .map((e) => e.text)
      .join(' ');
  }

  public isStreamingEnabled(): boolean {
    return this.streamingEnabled;
  }

  public setStreamingEnabled(enabled: boolean) {
    this.streamingEnabled = enabled;
    try {
      localStorage.setItem('jarvis_tts_streaming', enabled ? 'on' : 'off');
    } catch {}
  }

  private useStreaming(): boolean {
    return this.streamingEnabled && this.selectedPreset.provider !== 'edge';
  }

  private speechCacheKey(spokenText: string): string {
    const preset = this.selectedPreset;
    const effectiveVoice =
      preset.voice === 'AUTO_DESIGN_JARVIS' && this.customDesignedVoiceId ? this.customDesignedVoiceId : preset.voice;
    return `${preset.id}::${effectiveVoice}::${this.getEffectiveStyle()}::${spokenText}`;
  }

  /** A clip whose playback is recorded in the speech log (used by the echo filter). */
  private startClip(text: string, signal: AbortSignal): SpeechClip {
    const clip = this.createClip(text, signal);
    return {
      ...clip,
      play: async (onStart) => {
        const end = this.noteSpeech(clip.text);
        try {
          await clip.play(onStart);
        } finally {
          end();
        }
      },
    };
  }

  private createClip(text: string, signal: AbortSignal): SpeechClip {
    const cached = this.audioBufferCache.get(this.speechCacheKey(text));
    if (cached) {
      return {
        text,
        downloaded: Promise.resolve(),
        play: async (onStart) => {
          if (signal.aborted) return;
          if (this.ctx?.state === 'suspended') await this.ctx.resume();
          await this.playBuffer(cached, onStart);
        },
      };
    }
    if (!this.useStreaming()) {
      const pending = this.fetchSpeechBuffer(text, signal);
      pending.catch(() => {});
      return {
        text,
        downloaded: pending.then(
          () => undefined,
          () => undefined
        ),
        play: async (onStart) => {
          let buffer: AudioBuffer;
          try {
            buffer = await pending;
          } catch (err) {
            if (signal.aborted) return;
            console.warn('[JarvisAudioEngine] Neural TTS failed, using browser speech:', err);
            await this.speakFallbackBrowser(text, onStart);
            return;
          }
          if (signal.aborted) return;
          if (this.ctx?.state === 'suspended') await this.ctx.resume();
          await this.playBuffer(buffer, onStart);
        },
      };
    }
    return this.startStreamingClip(text, signal);
  }

  private startStreamingClip(text: string, signal: AbortSignal): SpeechClip {
    const ctx = this.ensureContext();
    const preset = this.selectedPreset;
    const cacheKey = this.speechCacheKey(text);
    const label = text.length > 48 ? `${text.slice(0, 45)}...` : text;
    const state = {
      chunks: [] as Float32Array[],
      sampleRate: 24000,
      done: false,
      failed: null as Error | null,
      listeners: new Set<() => void>(),
    };
    const notify = () => {
      const ls = [...state.listeners];
      state.listeners.clear();
      ls.forEach((l) => l());
    };
    signal.addEventListener('abort', notify);
    const changed = () => new Promise<void>((resolve) => state.listeners.add(resolve));

    const download = this.withGeminiSlot(async () => {
      const t0 = performance.now();
      const result = await this.requestTts(
        {
          text,
          provider: preset.provider,
          model: preset.model,
          voice:
            preset.voice === 'AUTO_DESIGN_JARVIS' && this.customDesignedVoiceId
              ? this.customDesignedVoiceId
              : preset.voice,
          style: this.getEffectiveStyle(),
          stream: true,
          fallback: false,
          geminiTimeoutMs: GEMINI_SERVER_TIMEOUT_MS,
        },
        signal,
        GEMINI_SERVER_TIMEOUT_MS + 3000
      );
      if (!result.response?.body) throw new Error(result.error || 'no response');
      const response = result.response;
      const engine = response.headers.get('X-TTS-Engine') || preset.model;
      this.lastActiveEngine = engine;

      if (response.headers.get('X-TTS-Format') !== 'pcm16') {
        // Not streamed (e.g. a non-PCM cache hit): decode it whole
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        state.sampleRate = buffer.sampleRate;
        state.chunks.push(buffer.getChannelData(0).slice());
        notify();
        return { engine, firstMs: performance.now() - t0, totalMs: performance.now() - t0 };
      }

      state.sampleRate = Number(response.headers.get('X-TTS-Sample-Rate')) || 24000;
      const reader = response.body!.getReader();
      let leftover: Uint8Array | null = null;
      let firstMs = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        let bytes: Uint8Array = value;
        if (leftover) {
          const joined = new Uint8Array(leftover.byteLength + value.byteLength);
          joined.set(leftover, 0);
          joined.set(value, leftover.byteLength);
          bytes = joined;
          leftover = null;
        }
        const even = bytes.byteLength - (bytes.byteLength % 2);
        if (even < bytes.byteLength) leftover = bytes.slice(even);
        if (!even) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, even);
        const samples = new Float32Array(even / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        state.chunks.push(samples);
        if (!firstMs) firstMs = performance.now() - t0;
        notify();
      }
      return { engine, firstMs, totalMs: performance.now() - t0 };
    }).then(
      ({ engine, firstMs, totalMs }) => {
        state.done = true;
        notify();
        // Keep the whole clip for instant replays
        const total = state.chunks.reduce((n, c) => n + c.length, 0);
        if (total > 0) {
          const full = ctx.createBuffer(1, total, state.sampleRate);
          let offset = 0;
          for (const c of state.chunks) {
            full.copyToChannel(c as Float32Array<ArrayBuffer>, 0, offset);
            offset += c.length;
          }
          if (this.audioBufferCache.size > 35) {
            const oldestKey = this.audioBufferCache.keys().next().value;
            if (oldestKey) this.audioBufferCache.delete(oldestKey);
          }
          this.audioBufferCache.set(cacheKey, full);
          if (full.duration >= 2) void voiceBiometrics.learnJarvisVoice(full);
        }
        this.recordSpeechDiagnostic({
          text: label,
          engine: `${engine} · streamed`,
          ms: Math.round(totalMs),
          note: `first audio ${(firstMs / 1000).toFixed(1)}s`,
          fallback: false,
        });
      },
      (err: unknown) => {
        state.failed = err instanceof Error ? err : new Error(String(err));
        notify();
      }
    );

    const play = async (onStart: () => void) => {
      while (!state.chunks.length && !state.done && !state.failed && !signal.aborted) await changed();
      if (signal.aborted) return;

      if (!state.chunks.length) {
        // Stream failed before any audio: use the regular path (retry in the same voice, then Edge)
        if (state.failed) {
          this.recordSpeechDiagnostic({
            text: label,
            engine: 'stream failed, retrying unstreamed',
            ms: 0,
            note: state.failed.message.slice(0, 160),
            fallback: true,
          });
        }
        try {
          const buffer = await this.fetchSpeechBuffer(text, signal);
          if (!signal.aborted) await this.playBuffer(buffer, onStart);
        } catch {
          if (!signal.aborted) await this.speakFallbackBrowser(text, onStart);
        }
        return;
      }

      if (ctx.state === 'suspended') await ctx.resume();
      const input = ctx.createGain();
      this.connectJarvisVocalChain(input, preset.hudDsp);
      this.currentState = 'speaking';
      onStart();

      let nextTime = ctx.currentTime + 0.05;
      let scheduled = 0;
      let lastEnded: Promise<void> = Promise.resolve();
      while (!signal.aborted) {
        while (scheduled < state.chunks.length) {
          const data = state.chunks[scheduled++];
          const buffer = ctx.createBuffer(1, data.length, state.sampleRate);
          buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(input);
          const at = Math.max(nextTime, ctx.currentTime + 0.02); // catch up after an underrun
          source.start(at);
          nextTime = at + buffer.duration;
          this.streamSources.add(source);
          lastEnded = new Promise<void>((resolve) => {
            source.onended = () => {
              this.streamSources.delete(source);
              resolve();
            };
          });
        }
        if (state.done || state.failed) break;
        await changed();
      }
      if (!signal.aborted) {
        await Promise.race([lastEnded, new Promise<void>((r) => signal.addEventListener('abort', () => r()))]);
      }
      signal.removeEventListener('abort', notify);
      setTimeout(() => {
        try {
          input.disconnect();
        } catch {}
      }, 500);
    };

    return { text, downloaded: download.then(() => undefined), play };
  }

  private playBuffer(audioBuffer: AudioBuffer, onStart?: () => void): Promise<void> {
    const ctx = this.ensureContext();
    if (audioBuffer.duration >= 2) void voiceBiometrics.learnJarvisVoice(audioBuffer);
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      this.activeSourceNode = source;

      this.connectJarvisVocalChain(source, this.selectedPreset.hudDsp);

      this.currentState = 'speaking';
      onStart?.();

      source.onended = () => {
        if (this.activeSourceNode === source) {
          this.activeSourceNode = null;
        }
        resolve();
      };

      source.start(0);
    });
  }

  /**
   * Warm up the TTS serverless function (avoids a cold start on the first reply).
   * Call when the wake word fires, while the user is still talking.
   */
  public prewarm() {
    const now = Date.now();
    if (now - this.lastPrewarmAt < 60_000) return;
    this.lastPrewarmAt = now;
    void fetch('/api/tts', {
      method: 'POST',
      headers: this.buildTtsHeaders(),
      body: JSON.stringify({ action: 'status' }),
    }).catch(() => {});
    void this.preloadAcknowledgements();
  }

  private ackStorageKey(phrase: string): string {
    return `jarvis_ack::${this.selectedPreset.model}::${this.customDesignedVoiceId}::${this.getEffectiveStyle()}::${phrase}`;
  }

  /**
   * Synthesize the short "holding" phrases ahead of time so they can play instantly.
   * They're saved on the device per voice + delivery, so after the first time they cost no
   * Gemini requests at all. Only the Gemini voice is accepted: a holding phrase in the backup
   * voice would sound wrong, so on failure it's simply skipped and retried later.
   */
  public async preloadAcknowledgements(): Promise<void> {
    if (this.ackPreloadPromise) return this.ackPreloadPromise;
    const preset = this.selectedPreset;
    if (preset.provider === 'edge') return;
    const phrases = [...ACK_PHRASES_OWNER, ...ACK_PHRASES_GUEST];
    const ctx = this.ensureContext();
    const controller = new AbortController();

    const loadOne = async (phrase: string) => {
      if (this.ackBuffers.has(phrase)) return;
      const key = this.ackStorageKey(phrase);
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
          this.ackBuffers.set(phrase, await ctx.decodeAudioData(bytes.buffer));
          return;
        }
      } catch {}

      const voice =
        preset.voice === 'AUTO_DESIGN_JARVIS' && this.customDesignedVoiceId ? this.customDesignedVoiceId : preset.voice;
      const result = await this.withGeminiSlot(
        () =>
          this.requestTts(
            {
              text: phrase,
              provider: preset.provider,
              model: preset.model,
              voice,
              style: this.getEffectiveStyle(),
              fallback: false,
              geminiTimeoutMs: GEMINI_SERVER_TIMEOUT_MS,
            },
            controller.signal,
            GEMINI_SERVER_TIMEOUT_MS + 3000
          ),
        'low'
      );
      if (!result.response) return;
      const raw = await result.response.arrayBuffer();
      if (raw.byteLength < 256) return;
      this.ackBuffers.set(phrase, await ctx.decodeAudioData(raw.slice(0)));
      try {
        let binary = '';
        const bytes = new Uint8Array(raw);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        localStorage.setItem(key, btoa(binary));
      } catch {
        // Storage full or unavailable: the clip still works for this session
      }
    };

    // One at a time: these are background work and shouldn't add to rate-limit pressure
    this.ackPreloadPromise = (async () => {
      for (const phrase of phrases) {
        try {
          await loadOne(phrase);
        } catch {}
      }
      if (this.ackBuffers.size < phrases.length) this.ackPreloadPromise = null;
    })();
    return this.ackPreloadPromise;
  }

  /**
   * Play a short pre-synthesized acknowledgement ("One moment, sir.") to cover backend latency.
   * Does nothing if no phrase is ready yet. A following speak() waits for it to finish.
   */
  public playAcknowledgement(isOwner: boolean) {
    if (this.ackPromise || this.activeSourceNode) return;
    const pool = (isOwner ? ACK_PHRASES_OWNER : ACK_PHRASES_GUEST).filter((p) => this.ackBuffers.has(p));
    if (pool.length === 0) return;
    let phrase = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && phrase === this.lastAckPhrase) {
      phrase = pool[(pool.indexOf(phrase) + 1) % pool.length];
    }
    this.lastAckPhrase = phrase;
    const buffer = this.ackBuffers.get(phrase)!;
    const end = this.noteSpeech(phrase);
    this.ackPromise = this.playBuffer(buffer).finally(() => {
      end();
      this.ackPromise = null;
    });
  }

  public async speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    // Let a holding phrase finish naturally instead of cutting it off mid-word
    if (this.ackPromise) {
      await this.ackPromise;
    }
    this.stopSpeaking();

    const spokenText = this.cleanSpeechText(text);
    if (!spokenText) {
      onEnd?.();
      return;
    }

    this.ensureContext();
    const controller = new AbortController();
    this.activeAbortController = controller;

    // Streaming: first sentence alone (fast start), the rest in ~400-char groups (fewer requests).
    const chunks = this.splitIntoSpeechChunks(spokenText, this.useStreaming() ? 400 : 120);
    const clips = chunks.map((chunk) => this.startClip(chunk, controller.signal));

    let started = false;
    const handleStart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };

    try {
      for (const clip of clips) {
        if (controller.signal.aborted) break;
        await clip.play(handleStart);
      }
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
        this.currentState = 'idle';
      }
      onEnd?.();
    }
  }

  /**
   * Start a speech queue for a streamed reply. Each enqueued sentence is synthesized as soon as
   * it arrives (in parallel) and played in order with no gap. stopSpeaking() cancels the queue,
   * including sentences not yet synthesized. A playing "One moment, sir." finishes first.
   */
  public createSpeechQueue(onStart?: () => void, onEnd?: () => void): SpeechQueue {
    this.stopSpeaking();
    this.ensureContext();
    const controller = new AbortController();
    this.activeAbortController = controller;
    const { signal } = controller;

    const clips: SpeechClip[] = [];
    let finished = false;
    let wake: (() => void) | null = null;
    const wakeUp = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    signal.addEventListener('abort', wakeUp);

    // Grouping: the first sentence goes out alone for a fast start. With streaming, sentences that
    // arrive while the previous request is still downloading are batched into the next request,
    // so a reply costs ~2 requests instead of one per sentence.
    const streaming = this.useStreaming();
    let pending: string[] = [];
    let lastDownloaded = true;
    const flush = () => {
      if (!pending.length || signal.aborted) return;
      const text = pending.join(' ');
      pending = [];
      const clip = this.startClip(text, signal);
      clips.push(clip);
      lastDownloaded = false;
      clip.downloaded.then(() => {
        if (clips[clips.length - 1] === clip) {
          lastDownloaded = true;
          if (pending.length) flush();
        }
      });
      wakeUp();
    };

    let started = false;
    const handleStart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };

    const run = async () => {
      try {
        let i = 0;
        while (!signal.aborted) {
          if (i >= clips.length) {
            if (finished) break;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          const clip = clips[i++];
          if (this.ackPromise) await this.ackPromise;
          if (signal.aborted) break;
          await clip.play(handleStart);
        }
      } finally {
        signal.removeEventListener('abort', wakeUp);
        if (this.activeAbortController === controller) {
          this.activeAbortController = null;
          this.currentState = 'idle';
        }
        onEnd?.();
      }
    };

    const done = run();

    return {
      enqueue: (text: string) => {
        if (finished || signal.aborted) return;
        const spoken = this.cleanSpeechText(text);
        if (!spoken) return;
        pending.push(spoken);
        const pendingChars = pending.reduce((n, t) => n + t.length, 0);
        if (!streaming || clips.length === 0 || lastDownloaded || pendingChars >= 400) flush();
      },
      finish: () => {
        flush();
        finished = true;
        wakeUp();
      },
      done,
    };
  }

  private speakFallbackBrowser(
    spokenText: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        onEnd?.();
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      // Browser voices would read "<short pause>" aloud; a comma gives a brief pause instead
      const utterance = new SpeechSynthesisUtterance(
        stripPauseTags(spokenText, ', ').replace(/\s*,\s*([,.!?])/g, '$1').replace(/\s+/g, ' ').trim()
      );
      const voices = window.speechSynthesis.getVoices();
      const ukVoice =
        voices.find((v) => v.name.includes('RyanNeural')) ||
        voices.find((v) => v.name.includes('Google UK English Male')) ||
        voices.find((v) => v.name.toLowerCase().includes('daniel')) ||
        voices.find((v) => v.lang.startsWith('en-GB'));

      if (ukVoice) utterance.voice = ukVoice;
      utterance.rate = 0.98;
      utterance.pitch = 0.94;

      utterance.onstart = () => {
        this.currentState = 'speaking';
        this.startTtsVisualizerModulation();
        onStart?.();
      };

      utterance.onend = () => {
        this.stopTtsVisualizerModulation();
        this.currentState = 'idle';
        onEnd?.();
        resolve();
      };

      utterance.onerror = () => {
        this.stopTtsVisualizerModulation();
        this.currentState = 'idle';
        onEnd?.();
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  private startTtsVisualizerModulation() {
    this.ensureContext();
    if (!this.ctx || !this.analyser) return;

    this.stopTtsVisualizerModulation();
    this.isTtsActive = true;

    try {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, this.ctx.currentTime);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.analyser);
      osc.start();

      this.ttsOscillator = osc;
      this.ttsFilter = filter;
      this.ttsGain = gain;

      const animateTtsVoiceCadence = () => {
        if (!this.isTtsActive || !this.ctx || !this.ttsFilter || !this.ttsGain) return;
        const now = this.ctx.currentTime;
        this.ttsFilter.frequency.setTargetAtTime(400 + Math.random() * 1400, now, 0.06);
        this.ttsGain.gain.setTargetAtTime(0.08 + Math.random() * 0.22, now, 0.05);
        this.ttsSpeechAnimId = requestAnimationFrame(() => {
          setTimeout(animateTtsVoiceCadence, 50);
        });
      };

      animateTtsVoiceCadence();
    } catch {}
  }

  private stopTtsVisualizerModulation() {
    this.isTtsActive = false;
    if (this.ttsSpeechAnimId) {
      cancelAnimationFrame(this.ttsSpeechAnimId);
      this.ttsSpeechAnimId = null;
    }
    if (this.ttsOscillator) {
      try {
        this.ttsOscillator.stop();
        this.ttsOscillator.disconnect();
      } catch {}
      this.ttsOscillator = null;
    }
    if (this.ttsGain) {
      try {
        this.ttsGain.disconnect();
      } catch {}
      this.ttsGain = null;
    }
  }

  public stopSpeaking() {
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {}
      this.activeAbortController = null;
    }
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {}
      this.activeSourceNode = null;
    }
    this.streamSources.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    });
    this.streamSources.clear();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.stopTtsVisualizerModulation();
    if (this.currentState === 'speaking') {
      this.currentState = 'idle';
    }
  }

  public getAudioTelemetry(): {
    frequencyData: Uint8Array<ArrayBuffer>;
    timeDomainData: Uint8Array<ArrayBuffer>;
    averageFrequency: number;
    peakFrequency: number;
    volume: number;
    rmsVolume: number;
    bass: number;
    mid: number;
    treble: number;
    spectralCentroid: number;
  } {
    if (!this.analyser || !this.freqData || !this.timeData) {
      return {
        frequencyData: new Uint8Array(0),
        timeDomainData: new Uint8Array(0),
        averageFrequency: 0,
        peakFrequency: 0,
        volume: 0,
        rmsVolume: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        spectralCentroid: 0,
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    // 1. Compute True Time-Domain RMS Amplitude (instantaneous syllabic punch)
    let sumSquares = 0;
    const tLen = this.timeData.length;
    for (let i = 0; i < tLen; i++) {
      const norm = (this.timeData[i] - 128) / 128;
      sumSquares += norm * norm;
    }
    const rawRms = Math.sqrt(sumSquares / (tLen || 1));
    // Perceptual curve so normal speech (RMS ~0.04-0.25) maps cleanly to 0.15-1.0
    const rmsVolume = Math.min(1, Math.pow(rawRms * 4.2, 0.78));

    // 2. Compute Vocal Band Energies & Spectral Centroid (Timbre / Pitch Brightness)
    // With fftSize=512 at 48kHz, each bin is ~93.75 Hz:
    // Bins 1..6 (~90-600 Hz) = Bass / Vocal Fundamental Pitch
    // Bins 7..32 (~650-3000 Hz) = Mid / Vowel Formants
    // Bins 33..96 (~3100-9000 Hz) = Treble / Consonants & Sibilance
    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    let weightedFreqSum = 0;
    let totalVocalMag = 0;
    let peak = 0;

    const fLen = this.freqData.length;
    for (let i = 1; i < fLen; i++) {
      const val = this.freqData[i];
      if (val > peak) peak = val;

      if (i <= 6) {
        bassSum += val;
      } else if (i <= 32) {
        midSum += val;
      } else if (i <= 96) {
        trebleSum += val;
      }

      if (i <= 80) {
        weightedFreqSum += i * val;
        totalVocalMag += val;
      }
    }

    const bass = Math.min(1, Math.pow(bassSum / (6 * 210), 0.85));
    const mid = Math.min(1, Math.pow(midSum / (26 * 185), 0.85));
    const treble = Math.min(1, Math.pow(trebleSum / (64 * 140), 0.85));

    // Normalized spectral centroid (0.0 = deep baritone, 1.0 = bright high frequency)
    const rawCentroidBin = totalVocalMag > 10 ? weightedFreqSum / totalVocalMag : 12;
    const spectralCentroid = Math.min(1, Math.max(0, (rawCentroidBin - 4) / 36));

    const vocalBandVolume = Math.min(1, bass * 0.45 + mid * 0.42 + treble * 0.13);
    const volume = Math.min(1, Math.max(rmsVolume, vocalBandVolume));
    const avg = totalVocalMag / 80;


    return {
      frequencyData: this.freqData,
      timeDomainData: this.timeData,
      averageFrequency: avg,
      peakFrequency: peak,
      volume,
      rmsVolume,
      bass,
      mid,
      treble,
      spectralCentroid,
    };
  }

  public playSfx(type: 'activate' | 'wake' | 'processing' | 'response' | 'error' | 'standby') {
    try {
      this.ensureContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      if (type === 'standby') {
        // Soft falling two-note "I've stopped listening" (the reverse of the wake chime, quieter)
        [880, 587.33].forEach((freq, idx) => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const start = now + idx * 0.09;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.06, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          if (this.analyser) gain.connect(this.analyser);
          osc.start(start);
          osc.stop(start + 0.22);
        });
        return;
      }

      if (type === 'wake') {
        const frequencies = [587.33, 880, 1174.66];
        frequencies.forEach((freq, idx) => {
          if (!this.ctx) return;
          const toneOsc = this.ctx.createOscillator();
          const toneGain = this.ctx.createGain();
          const startTime = now + idx * 0.06;
          const duration = 0.16;

          toneOsc.type = 'sine';
          toneOsc.frequency.setValueAtTime(freq, startTime);
          toneGain.gain.setValueAtTime(0.12, startTime);
          toneGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

          toneOsc.connect(toneGain);
          toneGain.connect(this.ctx.destination);
          if (this.analyser) {
            toneGain.connect(this.analyser);
          }

          toneOsc.start(startTime);
          toneOsc.stop(startTime + duration + 0.05);
        });
        return;
      }

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      if (type === 'activate') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      } else if (type === 'processing') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      } else if (type === 'response') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(1050, now + 0.15);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(180, now + 0.1);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      if (this.analyser) {
        gain.connect(this.analyser);
      }

      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }

  public async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }

  public notifyWake(message: string = 'Listening for your command...') {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      try {
        new Notification('J.A.R.V.I.S. // Voice Assistant', {
          body: message,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' stroke='%2300f0ff' stroke-width='6' fill='%2302040a'/><circle cx='50' cy='50' r='25' fill='%2300f0ff'/></svg>",
          silent: true,
        });
      } catch {}
    }
  }
}

export const audioEngine = new JarvisAudioEngine();
