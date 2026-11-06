/**
 * Voice Biometrics & Speaker Recognition Engine
 * 
 * Computes acoustic spectral fingerprints (Fundamental Pitch F0, Formant Energy Bands,
 * Spectral Centroid, and Timbre Dynamics) using Web Audio API to enroll and identify
 * authorized speakers (e.g., Samuel vs. other voices) in real time.
 */

export interface VoiceProfile {
  id: string;
  name: string;
  isOwner: boolean;
  enrolledAt: string;
  samplesCount: number;
  // Normalized 16-dimensional acoustic vector
  vector: number[];
  // Average fundamental frequency F0 in Hz
  avgPitchHz: number;
  // Average spectral centroid (0..1)
  avgCentroid: number;
}

export interface SpeakerIdentificationResult {
  matchedProfile: VoiceProfile | null;
  name: string;
  confidence: number; // 0..1
  isOwner: boolean;
  isUnknown: boolean;
}

const STORAGE_KEY = 'jarvis_voice_profiles';
const OWNER_GATE_KEY = 'jarvis_owner_gate_enabled';

// 16 Critical Mel/Bark frequency band edges (Hz) covering human vocal resonance
const BAND_EDGES_HZ = [
  85, 130, 200, 300, 450, 650, 900, 1250, 1700, 2300, 3050, 4000, 5200, 6700, 8500, 11000
];

class VoiceBiometricsEngine {
  private profiles: VoiceProfile[] = [];
  private currentUtteranceFrames: number[][] = [];
  private currentPitchSamples: number[] = [];
  private currentCentroidSamples: number[] = [];
  private isCapturing = false;

  constructor() {
    this.loadProfiles();
  }

  public loadProfiles(): VoiceProfile[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.profiles = JSON.parse(raw);
      } else {
        // If empty, initialize default profile template for Samuel
        this.profiles = [];
      }
    } catch {
      this.profiles = [];
    }
    return this.profiles;
  }

  public saveProfiles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    } catch (e) {
      console.warn('[VoiceBiometrics] Failed to save profiles to localStorage:', e);
    }
  }

  public getProfiles(): VoiceProfile[] {
    return [...this.profiles];
  }

  public getOwnerProfile(): VoiceProfile | undefined {
    return this.profiles.find((p) => p.isOwner);
  }

  public isOwnerGateEnabled(): boolean {
    try {
      return localStorage.getItem(OWNER_GATE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  public setOwnerGateEnabled(enabled: boolean) {
    try {
      localStorage.setItem(OWNER_GATE_KEY, enabled ? 'true' : 'false');
    } catch {}
  }

  public deleteProfile(profileId: string) {
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    this.saveProfiles();
  }

  /**
   * Reset the frame collector for a new utterance
   */
  public startUtteranceCapture() {
    this.currentUtteranceFrames = [];
    this.currentPitchSamples = [];
    this.currentCentroidSamples = [];
    this.isCapturing = true;
  }

  public stopUtteranceCapture() {
    this.isCapturing = false;
  }

  /**
   * Feed a live frame from Web Audio AnalyserNode during speech
   */
  public ingestAudioFrame(
    frequencyData: Uint8Array,
    timeDomainData: Uint8Array,
    sampleRate = 48000
  ) {
    if (!this.isCapturing && this.currentUtteranceFrames.length === 0) {
      this.isCapturing = true;
    }

    // Check RMS volume to avoid ingesting silence/background room noise
    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const val = (timeDomainData[i] - 128) / 128;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / timeDomainData.length);
    if (rms < 0.035) {
      // Below vocal energy threshold
      return;
    }

    const nyquist = sampleRate / 2;
    const binWidth = nyquist / frequencyData.length;

    // 1. Extract 16 sub-band energies
    const bandEnergies = new Float32Array(BAND_EDGES_HZ.length);
    for (let b = 0; b < BAND_EDGES_HZ.length; b++) {
      const startFreq = BAND_EDGES_HZ[b];
      const endFreq = b < BAND_EDGES_HZ.length - 1 ? BAND_EDGES_HZ[b + 1] : nyquist;

      const startBin = Math.max(1, Math.floor(startFreq / binWidth));
      const endBin = Math.min(frequencyData.length - 1, Math.ceil(endFreq / binWidth));

      let bandSum = 0;
      let count = 0;
      for (let bin = startBin; bin <= endBin; bin++) {
        bandSum += frequencyData[bin];
        count++;
      }
      bandEnergies[b] = count > 0 ? bandSum / (count * 255) : 0;
    }

    // 2. Estimate Fundamental Frequency (F0) via peak harmonic analysis in 80..350Hz range
    const f0MinBin = Math.max(1, Math.floor(80 / binWidth));
    const f0MaxBin = Math.min(frequencyData.length - 1, Math.ceil(350 / binWidth));
    let peakBin = f0MinBin;
    let peakVal = 0;
    for (let bin = f0MinBin; bin <= f0MaxBin; bin++) {
      if (frequencyData[bin] > peakVal) {
        peakVal = frequencyData[bin];
        peakBin = bin;
      }
    }
    const estimatedPitchHz = peakBin * binWidth;
    if (peakVal > 40) {
      this.currentPitchSamples.push(estimatedPitchHz);
    }

    // 3. Spectral Centroid
    let weightedSum = 0;
    let totalMagnitude = 0;
    for (let i = 0; i < frequencyData.length; i++) {
      const mag = frequencyData[i];
      weightedSum += i * binWidth * mag;
      totalMagnitude += mag;
    }
    const centroidHz = totalMagnitude > 0 ? weightedSum / totalMagnitude : 1500;
    this.currentCentroidSamples.push(Math.min(1, centroidHz / 4000));

    // Vector normalization
    const normalizedFrame = this.normalizeVector(Array.from(bandEnergies));
    this.currentUtteranceFrames.push(normalizedFrame);

    // Keep memory bounded to last 150 vocal frames (~3-5 seconds of speech)
    if (this.currentUtteranceFrames.length > 150) {
      this.currentUtteranceFrames.shift();
    }
    if (this.currentPitchSamples.length > 150) {
      this.currentPitchSamples.shift();
    }
    if (this.currentCentroidSamples.length > 150) {
      this.currentCentroidSamples.shift();
    }
  }

  /**
   * Compare the current captured utterance against all enrolled voice profiles
   */
  public identifySpeaker(): SpeakerIdentificationResult {
    this.isCapturing = false;

    if (this.currentUtteranceFrames.length < 5) {
      // Too few frames for confident voice identification
      const defaultOwner = this.getOwnerProfile();
      return {
        matchedProfile: defaultOwner || null,
        name: defaultOwner ? defaultOwner.name : 'Unknown Voice',
        confidence: defaultOwner ? 0.85 : 0.4,
        isOwner: defaultOwner ? defaultOwner.isOwner : false,
        isUnknown: !defaultOwner,
      };
    }

    // Average the utterance frames to get live acoustic profile
    const liveVector = this.averageVectors(this.currentUtteranceFrames);
    const avgPitch = this.currentPitchSamples.length > 0
      ? this.currentPitchSamples.reduce((a, b) => a + b, 0) / this.currentPitchSamples.length
      : 130;
    const avgCentroid = this.currentCentroidSamples.length > 0
      ? this.currentCentroidSamples.reduce((a, b) => a + b, 0) / this.currentCentroidSamples.length
      : 0.35;

    if (this.profiles.length === 0) {
      return {
        matchedProfile: null,
        name: 'Guest / Unenrolled',
        confidence: 0.6,
        isOwner: true, // Default to authorized if no profiles set yet
        isUnknown: true,
      };
    }

    let bestProfile: VoiceProfile | null = null;
    let bestSimilarity = -1;

    for (const profile of this.profiles) {
      // 1. Spectral cosine similarity (weight: 70%)
      const cosineSim = this.computeCosineSimilarity(liveVector, profile.vector);

      // 2. Pitch similarity (weight: 20%)
      const pitchDiff = Math.abs(avgPitch - profile.avgPitchHz);
      const pitchSim = Math.max(0, 1 - pitchDiff / 100);

      // 3. Timbre centroid similarity (weight: 10%)
      const centroidDiff = Math.abs(avgCentroid - profile.avgCentroid);
      const centroidSim = Math.max(0, 1 - centroidDiff * 2);

      const totalConfidence = cosineSim * 0.70 + pitchSim * 0.20 + centroidSim * 0.10;

      if (totalConfidence > bestSimilarity) {
        bestSimilarity = totalConfidence;
        bestProfile = profile;
      }
    }

    // Threshold for genuine match
    const MATCH_THRESHOLD = 0.76;
    if (bestProfile && bestSimilarity >= MATCH_THRESHOLD) {
      return {
        matchedProfile: bestProfile,
        name: bestProfile.name,
        confidence: Math.min(0.99, Math.round(bestSimilarity * 100) / 100),
        isOwner: bestProfile.isOwner,
        isUnknown: false,
      };
    }

    return {
      matchedProfile: null,
      name: 'Unrecognized Speaker',
      confidence: Math.max(0.2, Math.round((bestSimilarity || 0.4) * 100) / 100),
      isOwner: false,
      isUnknown: true,
    };
  }

  /**
   * Enroll a new voice profile from currently captured utterance frames
   */
  public enrollProfile(name: string, isOwner = false): VoiceProfile {
    if (this.currentUtteranceFrames.length < 5) {
      throw new Error('Insufficient audio captured during calibration. Please speak clearly into the microphone.');
    }

    const vector = this.averageVectors(this.currentUtteranceFrames);
    const avgPitchHz = this.currentPitchSamples.length > 0
      ? this.currentPitchSamples.reduce((a, b) => a + b, 0) / this.currentPitchSamples.length
      : 130;
    const avgCentroid = this.currentCentroidSamples.length > 0
      ? this.currentCentroidSamples.reduce((a, b) => a + b, 0) / this.currentCentroidSamples.length
      : 0.35;

    // If marked as owner, remove owner flag from other profiles
    if (isOwner) {
      this.profiles.forEach((p) => {
        p.isOwner = false;
      });
    }

    const newProfile: VoiceProfile = {
      id: `voice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Samuel',
      isOwner,
      enrolledAt: new Date().toISOString(),
      samplesCount: this.currentUtteranceFrames.length,
      vector,
      avgPitchHz: Math.round(avgPitchHz),
      avgCentroid: Math.round(avgCentroid * 1000) / 1000,
    };

    // Remove existing profile with same name if any
    this.profiles = this.profiles.filter((p) => p.name.toLowerCase() !== newProfile.name.toLowerCase());
    this.profiles.push(newProfile);
    this.saveProfiles();

    return newProfile;
  }

  private normalizeVector(v: number[]): number[] {
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return v;
    return v.map((x) => x / norm);
  }

  private averageVectors(frames: number[][]): number[] {
    if (frames.length === 0) return [];
    const len = frames[0].length;
    const avg = new Array(len).fill(0);
    for (const frame of frames) {
      for (let i = 0; i < len; i++) {
        avg[i] += frame[i];
      }
    }
    for (let i = 0; i < len; i++) {
      avg[i] /= frames.length;
    }
    return this.normalizeVector(avg);
  }

  private computeCosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? Math.max(0, dot / denom) : 0;
  }
}

export const voiceBiometrics = new VoiceBiometricsEngine();
