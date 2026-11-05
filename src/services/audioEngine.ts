// Singleton Web Audio API & TTS Engine for J.A.R.V.I.S.

export type JarvisAudioState = 'idle' | 'listening' | 'processing' | 'speaking';

class JarvisAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  
  // TTS synthesis nodes
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
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private availableVoices: SpeechSynthesisVoice[] = [];

  constructor() {
    this.initVoices();
  }

  private initVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        this.availableVoices = window.speechSynthesis.getVoices();
        // Priority order:
        // 1. en-GB-RyanNeural (Edge TTS British Ryan)
        // 2. Microsoft Ryan Online (Natural) - English (United Kingdom)
        // 3. Google UK English Male
        // 4. Daniel (macOS British Male)
        // 5. Oliver / George / British English
        // 6. Any en-GB
        // 7. en-US / default
        const ryan = this.availableVoices.find(v => 
          v.name.includes('RyanNeural') || 
          (v.name.toLowerCase().includes('ryan') && v.lang.startsWith('en-GB'))
        );
        const ukMale = this.availableVoices.find(v => 
          v.name.includes('Google UK English Male') ||
          v.name.includes('Daniel') ||
          v.name.includes('Oliver') ||
          (v.lang.startsWith('en-GB') && v.name.toLowerCase().includes('male'))
        );
        const enGb = this.availableVoices.find(v => v.lang.startsWith('en-GB'));
        const defaultVoice = this.availableVoices.find(v => v.default) || this.availableVoices[0];

        this.selectedVoice = ryan || ukMale || enGb || defaultVoice || null;
      };

      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  public getVoiceName(): string {
    return this.selectedVoice?.name || 'en-GB-RyanNeural (System Emulated)';
  }

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.availableVoices;
  }

  public setVoice(voice: SpeechSynthesisVoice) {
    this.selectedVoice = voice;
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    // Initialize background audio keep-alive if not already present
    this.ensureKeepAlive();

    return this.ctx;
  }

  private ensureKeepAlive() {
    if (!this.ctx || this.keepAliveOsc) return;
    try {
      // Create an ultra-low inaudible oscillator (5Hz, gain 0.00001) connected to destination
      // This signals to macOS and Chrome that the tab has an active audio output pipeline,
      // preventing background process suspension.
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
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.currentState === 'listening') {
      this.currentState = 'idle';
    }
  }

  // Route TTS playback through synthetic audio frequency modulator into AnalyserNode
  private startTtsVisualizerModulation() {
    this.ensureContext();
    if (!this.ctx || !this.analyser) return;

    this.stopTtsVisualizerModulation();
    this.isTtsActive = true;

    try {
      // Create a multi-harmonic formant synth that routes directly to the analyser
      // and a very low ambient hum to destination for immersive tactile Jarvis feedback
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, this.ctx.currentTime); // male vocal pitch base

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(240, this.ctx.currentTime);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      filter.Q.setValueAtTime(3.0, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      // Connect to analyser for reactivity!
      gain.connect(this.analyser);

      // Low level audible sci-fi vocoder undertone (subtle 0.015 volume)
      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.012, this.ctx.currentTime);
      gain.connect(subGain);
      subGain.connect(this.ctx.destination);

      osc.start();
      osc2.start();

      this.ttsOscillator = osc;
      this.ttsFilter = filter;
      this.ttsGain = gain;

      // Cadence simulation matching British speech intonation
      const animateTtsVoiceCadence = () => {
        if (!this.isTtsActive || !this.ctx || !this.ttsFilter || !this.ttsGain) return;
        const now = this.ctx.currentTime;
        const targetFreq = 400 + Math.random() * 1400;
        const targetGain = 0.08 + Math.random() * 0.22;
        this.ttsFilter.frequency.setTargetAtTime(targetFreq, now, 0.06);
        this.ttsGain.gain.setTargetAtTime(targetGain, now, 0.05);

        this.ttsSpeechAnimId = requestAnimationFrame(() => {
          setTimeout(animateTtsVoiceCadence, 40 + Math.random() * 70);
        });
      };

      animateTtsVoiceCadence();
    } catch (e) {
      console.warn('[JarvisAudioEngine] Could not initialize TTS frequency modulator:', e);
    }
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

  // Text-To-Speech with en-GB-RyanNeural preference & visualizer reactivity
  public speak(
    text: string, 
    onStart?: () => void, 
    onEnd?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        console.warn('[JarvisAudioEngine] SpeechSynthesis not supported.');
        onEnd?.();
        resolve();
        return;
      }

      // Stop any ongoing speech
      window.speechSynthesis.cancel();
      this.stopTtsVisualizerModulation();

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }
      utterance.rate = 1.05; // crisp British tempo
      utterance.pitch = 0.95; // authoritative lower British cadence

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

      utterance.onerror = (e) => {
        console.warn('[JarvisAudioEngine] TTS error:', e);
        this.stopTtsVisualizerModulation();
        this.currentState = 'idle';
        onEnd?.();
        resolve();
      };

      // Workaround for Chrome speech synthesis long-text pause bug
      const resumeInterval = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          clearInterval(resumeInterval);
        } else {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 10000);

      window.speechSynthesis.speak(utterance);
    });
  }

  public stopSpeaking() {
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
        // High-tech 3-tone Stark Industries wake chime
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

  // System notification for background wake-word events
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
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('J.A.R.V.I.S. // Voice Assistant', {
          body: message,
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' stroke='%2300f0ff' stroke-width='6' fill='%2302040a'/><circle cx='50' cy='50' r='25' fill='%2300f0ff'/></svg>",
          silent: true, // We already play our Stark audio chime
        });
      } catch {}
    }
  }
}

export const audioEngine = new JarvisAudioEngine();
