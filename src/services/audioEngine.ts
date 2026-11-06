// Singleton Web Audio API & Gemini 3.8 Expressive TTS Engine for J.A.R.V.I.S.

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
    edgeVoice: 'en-GB-RyanNeural',
    accent: 'en-GB • Custom Designed British Baritone',
    description:
      'Expressive human Gemini 3.8 Flash TTS using a custom-designed Paul Bettany British AI butler persona.',
    style:
      'calm, composed, articulate British gentleman AI assistant, warm resonant baritone, natural human breathing and subtle dry wit',
    rate: '+4%',
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
    edgeVoice: 'en-GB-RyanNeural',
    accent: 'en-GB • Low-Latency Expressive',
    description:
      'Fastest Gemini 3.8 Lite TTS model for rapid conversational turn-taking with your custom Jarvis voice.',
    style:
      'crisp, responsive, composed British gentleman AI butler, natural conversational cadence',
    rate: '+4%',
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
  private customDesignedVoiceId: string = 'voice_g67uthl21vr5';
  private clientGeminiApiKey: string = '';
  private lastActiveEngine: string = 'gemini-3.8-flash-tts';

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
      if (savedCustomVoiceId) {
        this.customDesignedVoiceId = savedCustomVoiceId;
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

  public async designCustomJarvisVoice(prompt?: string): Promise<string | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.clientGeminiApiKey) {
      headers['x-gemini-api-key'] = this.clientGeminiApiKey;
    }
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'design_voice',
        prompt,
      }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.voiceId) {
      this.setCustomDesignedVoiceId(data.voiceId);
      return data.voiceId;
    }
    return null;
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
    chestWarmth.gain.setValueAtTime(2.2, this.ctx.currentTime);
    chestWarmth.Q.setValueAtTime(1.1, this.ctx.currentTime);

    const clarityCut = this.ctx.createBiquadFilter();
    clarityCut.type = 'peaking';
    clarityCut.frequency.setValueAtTime(480, this.ctx.currentTime);
    clarityCut.gain.setValueAtTime(-1.5, this.ctx.currentTime);
    clarityCut.Q.setValueAtTime(1.4, this.ctx.currentTime);

    const presenceBoost = this.ctx.createBiquadFilter();
    presenceBoost.type = 'peaking';
    presenceBoost.frequency.setValueAtTime(3650, this.ctx.currentTime);
    presenceBoost.gain.setValueAtTime(2.4, this.ctx.currentTime);
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
    wetGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

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

  public async speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    this.stopSpeaking();

    const spokenText = this.cleanSpeechText(text);
    if (!spokenText) {
      onEnd?.();
      return;
    }

    const ctx = this.ensureContext();
    const preset = this.selectedPreset;
    const effectiveVoice =
      preset.voice === 'AUTO_DESIGN_JARVIS' && this.customDesignedVoiceId
        ? this.customDesignedVoiceId
        : preset.voice;

    const cacheKey = `${preset.id}::${effectiveVoice}::${spokenText}`;

    try {
      let audioBuffer = this.audioBufferCache.get(cacheKey);

      if (!audioBuffer) {
        const controller = new AbortController();
        this.activeAbortController = controller;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (this.clientGeminiApiKey) {
          headers['x-gemini-api-key'] = this.clientGeminiApiKey;
        }

        const response = await fetch('/api/tts', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: spokenText,
            provider: preset.provider,
            model: preset.model,
            voice: effectiveVoice,
            edgeVoice: preset.edgeVoice,
            style: preset.style,
            rate: preset.rate,
            pitch: preset.pitch,
          }),
          signal: controller.signal,
        });

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

        audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

        if (this.audioBufferCache.size > 35) {
          const oldestKey = this.audioBufferCache.keys().next().value;
          if (oldestKey) this.audioBufferCache.delete(oldestKey);
        }
        this.audioBufferCache.set(cacheKey, audioBuffer);
      }

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer!;
        this.activeSourceNode = source;

        this.connectJarvisVocalChain(source, preset.hudDsp);

        this.currentState = 'speaking';
        onStart?.();

        source.onended = () => {
          if (this.activeSourceNode === source) {
            this.activeSourceNode = null;
          }
          this.currentState = 'idle';
          onEnd?.();
          resolve();
        };

        source.start(0);
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.currentState = 'idle';
        onEnd?.();
        return;
      }
      console.warn('[JarvisAudioEngine] Neural TTS fallback to browser speechSynthesis:', err);
      await this.speakFallbackBrowser(spokenText, onStart, onEnd);
    } finally {
      this.activeAbortController = null;
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
