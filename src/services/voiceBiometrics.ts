/**
 * Voice Biometrics & Speaker Recognition
 *
 * - Neural voiceprints: 512-dim WeSpeaker CAM++ embeddings computed on the device
 *   (see speaker/speakerModel.ts). Voice audio never leaves the browser.
 * - Audio comes from a rolling microphone buffer (speaker/voiceCapture.ts), so the words spoken
 *   right after "Hey Jarvis" are captured too. Anything recorded while Jarvis was talking is
 *   left out.
 * - Owner status has to be earned: once an owner is enrolled, a voice command counts as the
 *   owner's only if it matches above OWNER_THRESHOLD. Too little audio, a weak match or a model
 *   problem all mean "guest", never "owner".
 * - Profiles keep their enrollment samples permanently, plus a few recent high-confidence
 *   utterances, so they adapt to the room/mic without drifting toward someone else.
 * - Guests can be auto-discovered, and "I'm Sarah" names a guest profile.
 *
 * Measured on LibriSpeech (10 speakers, 5-phrase enrollment): 2-3 s commands 86/87 identified
 * correctly, 0% impostors accepted / 1.1% owner rejected at 0.40; 1-1.5 s: 0% / 2.3%.
 * In Chrome with a simulated mic: owner 0.83-0.86, strangers 0.08-0.37 (threshold 0.50).
 * A phone mic in a room scores lower than studio speech, hence the guest-by-default rule.
 */
import { cosine, embedSpeech, getModelStatus, loadSpeakerModel, normalize } from './speaker/speakerModel';
import { extractSpeech, TimeInterval, voiceCapture } from './speaker/voiceCapture';

export interface VoiceProfile {
  id: string;
  name: string;
  isOwner: boolean;
  isAutoDiscovered?: boolean;
  enrolledAt: string;
  lastHeardAt: string;
  /** Utterances matched to this profile so far */
  samplesCount: number;
  /** Model the voiceprints belong to (profiles from another model are discarded) */
  model: 'campplus-v1';
  /** Enrollment voiceprints (kept forever) */
  enrollment: number[][];
  /** Recent high-confidence utterances (FIFO, small) */
  adaptive: number[][];
  /** Normalized mean of enrollment + adaptive */
  centroid: number[];
  /** Enrollment self-consistency: mean similarity of each sample to the others (0..1) */
  consistency?: number;
}

export type IdentificationReason =
  | 'match' // matched an enrolled voice above threshold
  | 'no-match' // voice heard clearly but it isn't anyone enrolled
  | 'too-short' // not enough speech captured to tell
  | 'typed' // typed command: the logged-in device holder
  | 'not-enrolled' // no owner enrolled yet: voice ID inactive
  | 'model-unavailable' // model failed to load or run
  | 'jarvis-echo'; // the "speaker" is Jarvis's own voice

export interface SpeakerIdentificationResult {
  matchedProfile: VoiceProfile | null;
  name: string;
  /** Similarity to the matched/closest profile, 0..1 */
  confidence: number;
  isOwner: boolean;
  isUnknown: boolean;
  isNewlyDiscovered?: boolean;
  reason: IdentificationReason;
  speechSeconds: number;
}

const STORAGE_KEY = 'jarvis_voice_profiles_v2';
const LEGACY_STORAGE_KEY = 'jarvis_voice_profiles';
const OWNER_GATE_KEY = 'jarvis_owner_gate_enabled';
const AUTO_LEARN_KEY = 'jarvis_auto_learn_voices_enabled';
const JARVIS_VOICE_KEY = 'jarvis_self_voiceprint_v1';

/**
 * Verified owner / known speaker. Clean-speech evaluation: 0% impostors at 0.40. Through
 * Chrome's mic processing the closest stranger reached 0.37 while the owner scored 0.83-0.86,
 * so 0.50 keeps a safe margin on both sides.
 */
export const MATCH_THRESHOLD = 0.5;
/** Below this, a clearly heard voice is a new person (auto-discovery) */
const NEW_VOICE_THRESHOLD = 0.3;
/** Utterances this confident are added to the profile's adaptive samples */
const ADAPT_THRESHOLD = 0.55;
/** If the utterance matches Jarvis's own TTS voice this well (and better than anyone), it's echo */
const JARVIS_ECHO_THRESHOLD = 0.55;
const MIN_SPEECH_SECONDS = 0.8;
const MIN_NEW_VOICE_SECONDS = 1.5;
const MAX_EMBED_SECONDS = 4; // the latest 4 s of speech is plenty and keeps inference fast
const MAX_ADAPTIVE = 10;
const UTTERANCE_WINDOW_MS = 9000;

const SELF_INTRO_REGEX = /\b(?:i am|i'm|my name is|this is|call me)\s+([a-zA-Z]+)(?:\b|[.,?!])/i;
const OWNER_INTRO_REGEX =
  /\b(?:this is my (?:friend|brother|sister|wife|husband|mom|dad|cousin|colleague|partner)|meet my friend|meet)\s+([a-zA-Z]+)(?:\b|[.,?!])/i;

export const ENROLLMENT_PHRASES = [
  'Jarvis, run a full diagnostic on the house systems and give me a summary.',
  "What's on my calendar for tomorrow morning, and is there anything I should prepare for?",
  'Play something relaxing in the living room and turn the volume down a little.',
  'Add coffee beans, eggs and sourdough bread to the shopping list in Motif.',
  'Remind me at five thirty to call the dealer team about the new order.',
];

function centroidOf(vectors: ArrayLike<number>[]): number[] {
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  return Array.from(normalize(sum));
}

const round4 = (v: ArrayLike<number>) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4);

class VoiceBiometricsEngine {
  private profiles: VoiceProfile[] = [];
  private legacyProfilesDiscarded = false;
  private jarvisVoiceprint: number[] | null = null;
  /** Returns intervals when Jarvis was audible (set by the app; excluded from captures) */
  private getJarvisIntervals: () => TimeInterval[] = () => [];

  constructor() {
    this.loadProfiles();
    try {
      const raw = localStorage.getItem(JARVIS_VOICE_KEY);
      if (raw) this.jarvisVoiceprint = JSON.parse(raw);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start the rolling mic buffer and preload the model (call after login). */
  public async activate(getJarvisIntervals: () => TimeInterval[]): Promise<void> {
    this.getJarvisIntervals = getJarvisIntervals;
    void loadSpeakerModel().catch(() => {});
    await voiceCapture.start();
  }

  public deactivate() {
    voiceCapture.stop();
  }

  public getStatus() {
    return {
      model: getModelStatus(),
      micBuffering: voiceCapture.isRunning(),
      legacyProfilesDiscarded: this.legacyProfilesDiscarded,
      hasJarvisVoiceprint: Boolean(this.jarvisVoiceprint),
    };
  }

  // ---------------------------------------------------------------------------
  // Profiles & settings
  // ---------------------------------------------------------------------------

  public loadProfiles(): VoiceProfile[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.profiles = raw ? (JSON.parse(raw) as VoiceProfile[]).filter((p) => p.model === 'campplus-v1') : [];
      if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
        // Old 16-band voiceprints can't be compared with neural ones: they must be re-enrolled
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        this.legacyProfilesDiscarded = true;
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
      console.warn('[VoiceBiometrics] Failed to save profiles:', e);
    }
  }

  public getProfiles(): VoiceProfile[] {
    return [...this.profiles];
  }

  public getOwnerProfile(): VoiceProfile | undefined {
    return this.profiles.find((p) => p.isOwner);
  }

  /** Owner gate: when on, voice commands that aren't verified as the owner are not carried out. */
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

  public isAutoLearnEnabled(): boolean {
    try {
      const val = localStorage.getItem(AUTO_LEARN_KEY);
      return val === null ? true : val === 'true';
    } catch {
      return true;
    }
  }

  public setAutoLearnEnabled(enabled: boolean) {
    try {
      localStorage.setItem(AUTO_LEARN_KEY, enabled ? 'true' : 'false');
    } catch {}
  }

  public deleteProfile(profileId: string) {
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    this.saveProfiles();
  }

  public renameProfile(profileId: string, newName: string) {
    const p = this.profiles.find((x) => x.id === profileId);
    if (p && newName.trim()) {
      p.name = newName.trim();
      p.isAutoDiscovered = false;
      this.saveProfiles();
    }
  }

  // ---------------------------------------------------------------------------
  // Jarvis's own voice (for rejecting echo)
  // ---------------------------------------------------------------------------

  /** Learn Jarvis's TTS voiceprint from a clip he spoke (called once by the audio engine). */
  public async learnJarvisVoice(clip: AudioBuffer): Promise<void> {
    if (this.jarvisVoiceprint || clip.duration < 2 || getModelStatus().status !== 'ready') return;
    try {
      const e = await embedSpeech(clip.getChannelData(0), clip.sampleRate);
      this.jarvisVoiceprint = round4(e);
      localStorage.setItem(JARVIS_VOICE_KEY, JSON.stringify(this.jarvisVoiceprint));
    } catch {}
  }

  public forgetJarvisVoice() {
    this.jarvisVoiceprint = null;
    try {
      localStorage.removeItem(JARVIS_VOICE_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  /**
   * The user's latest utterance from the rolling buffer: up to 9 s before now, starting no earlier
   * than when Jarvis last stopped talking, with his speech excluded.
   */
  private captureUtterance(): { samples: Float32Array; sampleRate: number } {
    const now = Date.now();
    const jarvis = this.getJarvisIntervals();
    const lastJarvisEnd = jarvis.reduce((m, iv) => (iv.end <= now ? Math.max(m, iv.end) : m), 0);
    const from = Math.max(now - UTTERANCE_WINDOW_MS, lastJarvisEnd);
    return { samples: voiceCapture.getAudio(from, now, jarvis), sampleRate: voiceCapture.sampleRate };
  }

  private async voiceprintFrom(samples: Float32Array, sampleRate: number) {
    const { speech, seconds } = extractSpeech(samples, sampleRate);
    if (seconds < MIN_SPEECH_SECONDS) return { embedding: null, seconds };
    const maxLen = Math.floor(MAX_EMBED_SECONDS * sampleRate);
    const clip = speech.length > maxLen ? speech.subarray(speech.length - maxLen) : speech;
    return { embedding: await embedSpeech(clip, sampleRate), seconds };
  }

  // ---------------------------------------------------------------------------
  // Identification
  // ---------------------------------------------------------------------------

  /**
   * Who just spoke? Grabs the audio synchronously (call it the moment the command is final),
   * then computes and compares the voiceprint.
   */
  public async identifySpeaker(
    spokenTranscript: string,
    source: 'voice' | 'typed' = 'voice'
  ): Promise<SpeakerIdentificationResult> {
    const owner = this.getOwnerProfile();
    const { samples, sampleRate } = this.captureUtterance(); // synchronous: before any await

    if (source === 'typed') {
      return this.result(owner ?? null, owner?.name ?? 'Owner', 1, true, 'typed', 0);
    }
    if (!owner) {
      // Voice ID isn't set up yet: the logged-in device is treated as the owner's
      return this.result(null, 'Owner', 1, true, 'not-enrolled', 0);
    }

    let embedding: Float32Array | null;
    let seconds: number;
    try {
      ({ embedding, seconds } = await this.voiceprintFrom(samples, sampleRate));
    } catch (err) {
      console.warn('[VoiceBiometrics] Identification unavailable:', err);
      return this.result(null, 'Unverified', 0, false, 'model-unavailable', 0);
    }
    if (!embedding) return this.result(null, 'Unverified', 0, false, 'too-short', seconds);

    // Score every profile
    let best: VoiceProfile | null = null;
    let bestScore = -1;
    for (const p of this.profiles) {
      const score = cosine(embedding, p.centroid);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    // Jarvis hearing himself (should be rare now, but never let it act as a person)
    if (this.jarvisVoiceprint) {
      const jarvisScore = cosine(embedding, this.jarvisVoiceprint);
      if (jarvisScore >= JARVIS_ECHO_THRESHOLD && jarvisScore > bestScore) {
        return this.result(null, 'Jarvis (echo)', jarvisScore, false, 'jarvis-echo', seconds);
      }
    }

    const introducedName = this.introducedName(spokenTranscript);

    if (best && bestScore >= MATCH_THRESHOLD) {
      if (introducedName && !best.isOwner && best.name !== introducedName) {
        best.name = introducedName;
        best.isAutoDiscovered = false;
      }
      if (bestScore >= ADAPT_THRESHOLD) {
        best.adaptive = [...(best.adaptive || []), round4(embedding)].slice(-MAX_ADAPTIVE);
        best.centroid = round4(centroidOf([...best.enrollment, ...best.adaptive]));
      }
      best.lastHeardAt = new Date().toISOString();
      best.samplesCount = (best.samplesCount || 0) + 1;
      this.saveProfiles();
      return this.result(best, best.name, bestScore, best.isOwner, 'match', seconds);
    }

    // A clearly different voice: optionally remember it as a guest
    if (this.isAutoLearnEnabled() && bestScore < NEW_VOICE_THRESHOLD && seconds >= MIN_NEW_VOICE_SECONDS) {
      const guestNumber = this.profiles.filter((p) => !p.isOwner).length + 1;
      const v = round4(embedding);
      const guest: VoiceProfile = {
        id: `voice_guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: introducedName || `Guest #${guestNumber}`,
        isOwner: false,
        isAutoDiscovered: !introducedName,
        enrolledAt: new Date().toISOString(),
        lastHeardAt: new Date().toISOString(),
        samplesCount: 1,
        model: 'campplus-v1',
        enrollment: [v],
        adaptive: [],
        centroid: v,
      };
      this.profiles.push(guest);
      this.saveProfiles();
      return { ...this.result(guest, guest.name, 1, false, 'no-match', seconds), isNewlyDiscovered: true };
    }

    return this.result(null, 'Unrecognized Speaker', Math.max(0, bestScore), false, 'no-match', seconds);
  }

  /** Not used for barge-in any more: the transcript echo filter handles Jarvis's own voice. */
  public isAuthorizedSpeaker(): { isAuthorized: boolean; confidence: number; name: string } {
    return { isAuthorized: true, confidence: 1, name: this.getOwnerProfile()?.name ?? 'Owner' };
  }

  private result(
    profile: VoiceProfile | null,
    name: string,
    confidence: number,
    isOwner: boolean,
    reason: IdentificationReason,
    speechSeconds: number
  ): SpeakerIdentificationResult {
    return {
      matchedProfile: profile,
      name,
      confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
      isOwner,
      isUnknown: !profile && reason !== 'typed' && reason !== 'not-enrolled',
      reason,
      speechSeconds: Math.round(speechSeconds * 10) / 10,
    };
  }

  private introducedName(transcript: string): string | null {
    const selfMatch = transcript.match(SELF_INTRO_REGEX);
    const ownerMatch = transcript.match(OWNER_INTRO_REGEX);
    const word = (selfMatch && selfMatch[1]) || (ownerMatch && ownerMatch[1]);
    if (!word || /^(jarvis|here|ready|sir|friday|computer|going|trying|not|just|back|done|sorry)$/i.test(word)) return null;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Enrollment
  // ---------------------------------------------------------------------------

  /**
   * Record one enrollment phrase: buffers `durationMs` of mic audio from now, then returns its
   * voiceprint. Rejects if there wasn't enough clear speech.
   */
  public async recordEnrollmentSample(durationMs = 6000): Promise<{ embedding: number[]; seconds: number }> {
    if (!voiceCapture.isRunning() && !(await voiceCapture.start())) {
      throw new Error('Microphone unavailable');
    }
    await loadSpeakerModel();
    const start = Date.now();
    await new Promise((r) => setTimeout(r, durationMs));
    const audio = voiceCapture.getAudio(start, Date.now(), this.getJarvisIntervals());
    const { embedding, seconds } = await this.voiceprintFrom(audio, voiceCapture.sampleRate);
    if (!embedding || seconds < 1.5) {
      throw new Error(`Only ${seconds.toFixed(1)}s of clear speech was heard. Please read the whole phrase.`);
    }
    return { embedding: round4(embedding), seconds };
  }

  /**
   * Check a set of enrollment voiceprints for consistency (each against the mean of the others).
   * Returns the per-sample scores and the index of any sample that doesn't fit.
   */
  public checkEnrollment(samples: number[][]): { scores: number[]; consistency: number; outlier: number | null } {
    const scores = samples.map((s, i) => cosine(s, centroidOf(samples.filter((_, j) => j !== i))));
    const consistency = scores.reduce((a, b) => a + b, 0) / scores.length;
    const worst = scores.indexOf(Math.min(...scores));
    return { scores, consistency, outlier: scores[worst] < 0.45 ? worst : null };
  }

  public saveEnrollment(name: string, isOwner: boolean, samples: number[][]): VoiceProfile {
    if (samples.length < 3) throw new Error('At least 3 phrases are needed');
    const { consistency } = this.checkEnrollment(samples);
    if (isOwner) this.profiles.forEach((p) => (p.isOwner = false));
    const profile: VoiceProfile = {
      id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Samuel',
      isOwner,
      isAutoDiscovered: false,
      enrolledAt: new Date().toISOString(),
      lastHeardAt: new Date().toISOString(),
      samplesCount: 0,
      model: 'campplus-v1',
      enrollment: samples,
      adaptive: [],
      centroid: round4(centroidOf(samples)),
      consistency: Math.round(consistency * 100) / 100,
    };
    this.profiles = this.profiles.filter((p) => p.name.toLowerCase() !== profile.name.toLowerCase());
    this.profiles.push(profile);
    this.saveProfiles();
    return profile;
  }

  /** "Test my voice": record a few seconds and report who it sounds like, without learning. */
  public async testVoice(durationMs = 4000): Promise<{ name: string; score: number; seconds: number; verified: boolean }> {
    if (!voiceCapture.isRunning() && !(await voiceCapture.start())) throw new Error('Microphone unavailable');
    await loadSpeakerModel();
    const start = Date.now();
    await new Promise((r) => setTimeout(r, durationMs));
    const audio = voiceCapture.getAudio(start, Date.now(), this.getJarvisIntervals());
    const { embedding, seconds } = await this.voiceprintFrom(audio, voiceCapture.sampleRate);
    if (!embedding) return { name: 'Not enough speech', score: 0, seconds, verified: false };
    let best: VoiceProfile | null = null;
    let bestScore = -1;
    for (const p of this.profiles) {
      const s = cosine(embedding, p.centroid);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    return {
      name: best ? best.name : 'No profiles enrolled',
      score: Math.max(0, Math.round(bestScore * 100) / 100),
      seconds: Math.round(seconds * 10) / 10,
      verified: bestScore >= MATCH_THRESHOLD,
    };
  }
}

export const voiceBiometrics = new VoiceBiometricsEngine();
