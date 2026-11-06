// Singleton Web Audio API & Gemini 3.8 Expressive TTS Engine for J.A.R.V.I.S.
import { voiceBiometrics } from './voiceBiometrics';

export type JarvisAudioState = 'idle' | 'listening' | 'processing' | 'speaking';

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
    style:
      'Calm, understated and precise. Quick, even pacing with brief natural pauses. Soft-spoken and close, never theatrical or upbeat. A faint, dry, amused politeness, as if addressing someone he knows very well.',
    rate: '+0%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'gemini-jarvis-lite',
    name: 'J.A.R.V.I.S. Rapid Ops (Gemini 3.8 Lite • Ultra-Fast)',
    shortLabel: 'Gemini 3.8 Lite',
    provider: 'gemini',
    model: 'gemini-3.8-flash-lite-tts',
    voice: 'AUTO_DESIGN_JARVIS',
    edgeVoice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Low-Latency Custom Voice',
    description:
      'Fastest Gemini 3.8 Lite TTS model with your custom voice for rapid conversational turn-taking.',
    style:
      'Crisp, responsive and composed. Quick, natural conversational cadence, soft-spoken, with a faint dry wit.',
    rate: '+0%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'gemini-charon',
    name: 'J.A.R.V.I.S. Studio (Gemini 3.8 • Charon Baritone)',
    shortLabel: 'Gemini Charon',
    provider: 'gemini',
    model: 'gemini-3.8-flash-tts',
    voice: 'Charon',
    edgeVoice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Deep Studio Baritone',
    description:
      'Prebuilt Gemini 3.8 Charon voice steered with refined British RP diction and studio warmth.',
    style:
      'refined British gentleman AI assistant, warm baritone, calm, composed and sophisticated',
    rate: '+3%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'gemini-sadaltager',
    name: 'J.A.R.V.I.S. Scholar (Gemini 3.8 • Sadaltager)',
    shortLabel: 'Gemini Sadaltager',
    provider: 'gemini',
    model: 'gemini-3.8-flash-tts',
    voice: 'Sadaltager',
    edgeVoice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Knowledgeable & Warm',
    description:
      'Articulate, thoughtful Gemini 3.8 voice ideal for detailed analytical briefings and diagnostics.',
    style:
      'articulate British butler AI, warm, intelligent, measured human cadence',
    rate: '+3%',
    pitch: '-1Hz',
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

// Short holding phrases, pre-synthesized so they play with zero latency
const ACK_PHRASES_OWNER = ['One moment, sir.', 'Working on it, sir.', 'Just a moment, sir.', 'On it, sir.'];
const ACK_PHRASES_GUEST = ['One moment, please.', 'Just a moment.'];

class JarvisAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
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

  // Voice Lab tuning (persisted per device)
  private voiceTuning: JarvisVoiceTuning = { ...DEFAULT_VOICE_TUNING };
  private voiceHistory: string[] = [];

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
  public async designCustomJarvisVoice(prompt?: string, baseVoice?: string): Promise<string | null> {
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

  /** Recently designed voice ids, newest first, so you can A/B and revert. */
  public getVoiceHistory(): string[] {
    const all = this.customDesignedVoiceId
      ? [this.customDesignedVoiceId, ...this.voiceHistory]
      : this.voiceHistory;
    return Array.from(new Set(all));
  }

  public getVoiceTuning(): JarvisVoiceTuning {
    return { ...this.voiceTuning };
  }

  public setVoiceTuning(patch: Partial<JarvisVoiceTuning>): JarvisVoiceTuning {
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

  public ensureContext(): AudioContext {
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

      if (!this.micStream) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      if (this.ctx && this.micStream && !this.micSource) {
        this.micSource = this.ctx.createMediaStreamSource(this.micStream);
        this.micSource.connect(this.analyser);
      }

      this.currentState = 'listening';
      voiceBiometrics.startUtteranceCapture();
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
      this.micStream.getTracks().forEach((track) => track.stop());
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
  private splitIntoSpeechChunks(text: string): string[] {
    // Break only where a sentence end is followed by a new sentence (keeps "6 p.m., so" intact)
    const sentences = text.split(/(?<=[.!?]["')\]]*)\s+(?=[A-Z0-9"'(<])/).map((s) => s.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      // First chunk: emit as soon as we have one sentence. Later chunks: group up to ~220 chars.
      const limit = chunks.length === 0 ? 0 : 220;
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
   * Fetch + decode one chunk of speech. Results that came from the intended engine are cached;
   * fallback audio is not, so a slow Gemini response doesn't lock in the backup voice.
   */
  private async fetchSpeechBuffer(spokenText: string, signal: AbortSignal): Promise<AudioBuffer> {
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

    const timeoutController = new AbortController();
    const onOuterAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onOuterAbort);
    const fetchTimeout = setTimeout(() => timeoutController.abort(), 10000);

    let response: Response;
    try {
      response = await fetch('/api/tts', {
        method: 'POST',
        headers: this.buildTtsHeaders(),
        body: JSON.stringify({
          text: spokenText,
          provider: preset.provider,
          model: preset.model,
          voice: effectiveVoice,
          edgeVoice: preset.edgeVoice,
          style,
          rate: preset.rate,
          pitch: preset.pitch,
        }),
        signal: timeoutController.signal,
      });
    } finally {
      clearTimeout(fetchTimeout);
      signal.removeEventListener('abort', onOuterAbort);
    }

    if (!response.ok) {
      throw new Error(`TTS API returned HTTP ${response.status}`);
    }

    const engineHeader = response.headers.get('X-TTS-Engine');
    if (engineHeader) {
      this.lastActiveEngine = engineHeader;
    }
    const resolvedVoiceHeader = response.headers.get('X-Gemini-Voice-Id');
    if (
      resolvedVoiceHeader &&
      resolvedVoiceHeader.startsWith('voice_') &&
      !this.customDesignedVoiceId
    ) {
      this.setCustomDesignedVoiceId(resolvedVoiceHeader);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength < 256) {
      throw new Error('Invalid audio buffer received');
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    const usedFallback =
      engineHeader === 'edge-neural-fallback' && preset.provider !== 'edge';
    if (!usedFallback) {
      if (this.audioBufferCache.size > 35) {
        const oldestKey = this.audioBufferCache.keys().next().value;
        if (oldestKey) this.audioBufferCache.delete(oldestKey);
      }
      this.audioBufferCache.set(cacheKey, audioBuffer);
    }
    return audioBuffer;
  }

  private playBuffer(audioBuffer: AudioBuffer, onStart?: () => void): Promise<void> {
    const ctx = this.ensureContext();
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

  /**
   * Synthesize the short "holding" phrases ahead of time so they can play instantly.
   */
  public async preloadAcknowledgements(): Promise<void> {
    if (this.ackPreloadPromise) return this.ackPreloadPromise;
    const phrases = [...ACK_PHRASES_OWNER, ...ACK_PHRASES_GUEST];
    const controller = new AbortController();
    this.ackPreloadPromise = Promise.all(
      phrases.map(async (phrase) => {
        if (this.ackBuffers.has(phrase)) return;
        try {
          const buffer = await this.fetchSpeechBuffer(phrase, controller.signal);
          this.ackBuffers.set(phrase, buffer);
        } catch {}
      })
    ).then(() => {
      // Retry later if some phrases failed (e.g. first call fell back or network hiccup)
      if (this.ackBuffers.size < phrases.length) this.ackPreloadPromise = null;
    });
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
    this.ackPromise = this.playBuffer(buffer).finally(() => {
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

    const chunks = this.splitIntoSpeechChunks(spokenText);
    // Start synthesizing every chunk immediately, in parallel; play them back in order.
    const pending = chunks.map((chunk) => {
      const p = this.fetchSpeechBuffer(chunk, controller.signal);
      p.catch(() => {}); // handled when awaited below
      return p;
    });

    let started = false;
    const handleStart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) break;
        let buffer: AudioBuffer;
        try {
          buffer = await pending[i];
        } catch (err) {
          if (controller.signal.aborted) break;
          console.warn('[JarvisAudioEngine] Neural TTS chunk failed, using browser speech for the rest:', err);
          await this.speakFallbackBrowser(chunks.slice(i).join(' '), handleStart);
          break;
        }
        if (controller.signal.aborted) break;
        if (this.ctx && this.ctx.state === 'suspended') {
          await this.ctx.resume();
        }
        await this.playBuffer(buffer, handleStart);
      }
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
        this.currentState = 'idle';
      }
      onEnd?.();
    }
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
      const utterance = new SpeechSynthesisUtterance(spokenText);
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

    // Feed real-time vocal frame to Voice Biometrics engine if listening to user
    if (this.currentState === 'listening' && volume > 0.04) {
      voiceBiometrics.ingestAudioFrame(this.freqData, this.timeData, this.ctx?.sampleRate || 48000);
    }

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

  public playSfx(type: 'activate' | 'wake' | 'processing' | 'response' | 'error') {
    try {
      this.ensureContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

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
