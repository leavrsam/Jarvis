// Singleton Web Audio API & Neural Edge-TTS Engine for J.A.R.V.I.S.

export type JarvisAudioState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface JarvisNeuralVoicePreset {
  id: string;
  name: string;
  shortLabel: string;
  voice: string;
  accent: string;
  description: string;
  rate: string;
  pitch: string;
  hudDsp: boolean;
}

export const JARVIS_NEURAL_VOICES: JarvisNeuralVoicePreset[] = [
  {
    id: 'jarvis-mk7',
    name: 'J.A.R.V.I.S. Mk-VII (Ryan Neural • Movie Tuned)',
    shortLabel: 'Ryan Neural (Mk-VII)',
    voice: 'en-GB-RyanNeural',
    accent: 'en-GB • British Baritone',
    description: 'Paul Bettany inspired British cadence with warm chest resonance & subtle Stark HUD presence.',
    rate: '+4%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'jarvis-thomas',
    name: 'J.A.R.V.I.S. Classic (Thomas Neural • British RP)',
    shortLabel: 'Thomas Neural (RP)',
    voice: 'en-GB-ThomasNeural',
    accent: 'en-GB • Received Pronunciation',
    description: 'Refined, aristocratic British gentleman voice with measured, composed delivery.',
    rate: '+3%',
    pitch: '-2Hz',
    hudDsp: true,
  },
  {
    id: 'jarvis-pure',
    name: 'J.A.R.V.I.S. Studio (Ryan Neural • Unfiltered)',
    shortLabel: 'Ryan Neural (Pure)',
    voice: 'en-GB-RyanNeural',
    accent: 'en-GB • Natural Studio',
    description: 'Pure 24kHz Microsoft Ryan Neural voice without helmet spatial EQ.',
    rate: '+2%',
    pitch: '+0Hz',
    hudDsp: false,
  },
  {
    id: 'friday-sonia',
    name: 'F.R.I.D.A.Y. Protocol (Sonia Neural • UK Female)',
    shortLabel: 'F.R.I.D.A.Y. (Sonia)',
    voice: 'en-GB-SoniaNeural',
    accent: 'en-GB • British Female',
    description: 'Crisp, intelligent female tactical AI assistant voice.',
    rate: '+4%',
    pitch: '+0Hz',
    hudDsp: true,
  },
  {
    id: 'jarvis-connor',
    name: 'Tactical Ops (Connor Neural • Irish Male)',
    shortLabel: 'Connor Neural (IE)',
    voice: 'en-IE-ConnorNeural',
    accent: 'en-IE • Irish Male',
    description: 'Warm, natural Irish accent with clear studio articulation.',
    rate: '+3%',
    pitch: '-1Hz',
    hudDsp: true,
  },
  {
    id: 'shield-christopher',
    name: 'S.H.I.E.L.D. Command (Christopher Neural • US)',
    shortLabel: 'Christopher (US)',
    voice: 'en-US-ChristopherNeural',
    accent: 'en-US • American Baritone',
    description: 'Deep, authoritative American command voice.',
    rate: '+3%',
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

  // Fallback TTS synthesis nodes (only used if offline)
  private ttsOscillator: OscillatorNode | null = null;
  private ttsGain: GainNode | null = null;
  private ttsFilter: BiquadFilterNode | null = null;
  private isTtsActive = false;
  private ttsSpeechAnimId: number | null = null;

  // Background Audio Keep-Alive (prevents browser from throttling AudioContext when tab is unfocused)
  private keepAliveOsc: OscillatorNode | null = null;

  // Analyser buffers
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  // State
  private currentState: JarvisAudioState = 'idle';
  private selectedPreset: JarvisNeuralVoicePreset = JARVIS_NEURAL_VOICES[0];

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

  // Connect microphone to AnalyserNode (without routing to destination to prevent feedback)
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

  // Clean text for natural human speech pronunciation (strip markdown, symbols, URLs)
  private cleanSpeechText(raw: string): string {
    return raw
      .replace(/https?:\/\/\S+/gi, '') // remove urls
      .replace(/[*_#`~[\]]/g, '') // remove markdown formatting characters
      .replace(/J\.A\.R\.V\.I\.S\./gi, 'Jarvis')
      .replace(/F\.R\.I\.D\.A\.Y\./gi, 'Friday')
      .replace(/n8n/gi, 'N-8-N')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build the Christopher Boyes / Iron Man Movie J.A.R.V.I.S. Vocal Mastering Chain.
   * Connects source -> EQ / Compressor / Optional Micro-Spatial HUD Presence -> Analyser & Destination.
   */
  private connectJarvisVocalChain(source: AudioNode, enableHudDsp: boolean) {
    if (!this.ctx || !this.analyser) return;

    if (!enableHudDsp) {
      // Pure studio neural path
      source.connect(this.analyser);
      source.connect(this.ctx.destination);
      return;
    }

    // 1. Sub-bass cleanup (80 Hz High-Pass)
    const highPass = this.ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(80, this.ctx.currentTime);
    highPass.Q.setValueAtTime(0.7, this.ctx.currentTime);

    // 2. Paul Bettany warm chest baritone body (190 Hz Peaking +2.4 dB)
    const chestWarmth = this.ctx.createBiquadFilter();
    chestWarmth.type = 'peaking';
    chestWarmth.frequency.setValueAtTime(190, this.ctx.currentTime);
    chestWarmth.gain.setValueAtTime(2.4, this.ctx.currentTime);
    chestWarmth.Q.setValueAtTime(1.1, this.ctx.currentTime);

    // 3. De-box cut (480 Hz Peaking -1.6 dB for studio condenser clarity)
    const clarityCut = this.ctx.createBiquadFilter();
    clarityCut.type = 'peaking';
    clarityCut.frequency.setValueAtTime(480, this.ctx.currentTime);
    clarityCut.gain.setValueAtTime(-1.6, this.ctx.currentTime);
    clarityCut.Q.setValueAtTime(1.4, this.ctx.currentTime);

    // 4. Crisp British articulation presence (3650 Hz Peaking +2.8 dB)
    const presenceBoost = this.ctx.createBiquadFilter();
    presenceBoost.type = 'peaking';
    presenceBoost.frequency.setValueAtTime(3650, this.ctx.currentTime);
    presenceBoost.gain.setValueAtTime(2.8, this.ctx.currentTime);
    presenceBoost.Q.setValueAtTime(1.2, this.ctx.currentTime);

    // 5. Crystalline air shelf (9200 Hz High-Shelf +1.8 dB)
    const airShelf = this.ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.setValueAtTime(9200, this.ctx.currentTime);
    airShelf.gain.setValueAtTime(1.8, this.ctx.currentTime);

    // 6. Broadcast studio compressor (keeps voice intimate and upfront like inside the Mark-VII helmet)
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, this.ctx.currentTime);
    compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(3.2, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    // 7. Subtle 11ms acoustic HUD room presence (9% wet)
    const dryGain = this.ctx.createGain();
    dryGain.gain.setValueAtTime(0.95, this.ctx.currentTime);

    const hudDelay = this.ctx.createDelay(0.05);
    hudDelay.delayTime.setValueAtTime(0.011, this.ctx.currentTime);

    const wetFilter = this.ctx.createBiquadFilter();
    wetFilter.type = 'bandpass';
    wetFilter.frequency.setValueAtTime(1800, this.ctx.currentTime);
    wetFilter.Q.setValueAtTime(0.9, this.ctx.currentTime);

    const wetGain = this.ctx.createGain();
    wetGain.gain.setValueAtTime(0.09, this.ctx.currentTime);

    const masterOut = this.ctx.createGain();
    masterOut.gain.setValueAtTime(1.08, this.ctx.currentTime);

    // Wire serial EQ chain
    source.connect(highPass);
    highPass.connect(chestWarmth);
    chestWarmth.connect(clarityCut);
    clarityCut.connect(presenceBoost);
    presenceBoost.connect(airShelf);
    airShelf.connect(compressor);

    // Dry + subtle HUD spatial reflection
    compressor.connect(dryGain);
    dryGain.connect(masterOut);

    compressor.connect(hudDelay);
    hudDelay.connect(wetFilter);
    wetFilter.connect(wetGain);
    wetGain.connect(masterOut);

    // Route real mastered voice into both the 3D Arc-Reactor Analyser and speakers
    masterOut.connect(this.analyser);
    masterOut.connect(this.ctx.destination);
  }

  /**
   * Primary Neural Speech Synthesizer:
   * Fetches real 24kHz Microsoft Edge Neural audio (`en-GB-RyanNeural` / `en-GB-ThomasNeural`),
   * decodes via Web Audio API, and routes directly through the J.A.R.V.I.S. mastering chain and 3D visualizer.
   */
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
    const cacheKey = `${preset.id}::${spokenText}`;

    try {
      let audioBuffer = this.audioBufferCache.get(cacheKey);

      if (!audioBuffer) {
        const controller = new AbortController();
        this.activeAbortController = controller;

        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: spokenText,
            voice: preset.voice,
            rate: preset.rate,
            pitch: preset.pitch,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`TTS API returned HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength < 256) {
          throw new Error('Invalid audio buffer received');
        }

        // Decode MP3 into raw PCM AudioBuffer
        audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

        // Cache up to 35 recent utterances in RAM
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

  // Offline fallback using browser SpeechSynthesis
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

  // Fetch frequency and waveform telemetry for visualizer
  public getAudioTelemetry(): {
    frequencyData: Uint8Array<ArrayBuffer>;
    timeDomainData: Uint8Array<ArrayBuffer>;
    averageFrequency: number;
    peakFrequency: number;
    volume: number;
  } {
    if (!this.analyser || !this.freqData || !this.timeData) {
      return {
        frequencyData: new Uint8Array(0),
        timeDomainData: new Uint8Array(0),
        averageFrequency: 0,
        peakFrequency: 0,
        volume: 0,
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    let sum = 0;
    let peak = 0;
    const len = this.freqData.length;
    for (let i = 0; i < len; i++) {
      const val = this.freqData[i];
      sum += val;
      if (val > peak) peak = val;
    }

    const avg = sum / (len || 1);
    const volume = Math.min(1, avg / 128);

    return {
      frequencyData: this.freqData,
      timeDomainData: this.timeData,
      averageFrequency: avg,
      peakFrequency: peak,
      volume,
    };
  }

  // Play sci-fi UI activation blip & wake chime
  public playSfx(type: 'activate' | 'wake' | 'processing' | 'response' | 'error') {
    try {
      this.ensureContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      if (type === 'wake') {
        const frequencies = [587.33, 880, 1174.66]; // D5, A5, D6
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
