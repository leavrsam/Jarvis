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
  /** Set when this utterance gave the speaker's profile a name ("I'm Sarah") */
  introducedAs?: string;
  /** Owner just introduced someone ("meet my sister Sarah"): the next new voice gets this name */
  expectingGuest?: string;
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
/** A guest's visit: follow-up commands within this window keep teaching their voiceprint */
const VISIT_WINDOW_MS = 3 * 60_000;
/** During a visit, the visiting guest is accepted from this score (their profile is still thin) */
const VISIT_CONTINUITY_THRESHOLD = 0.35;
/** ...but only if the owner clearly isn't the one talking */
const VISIT_OWNER_CEILING = 0.4;
/** Max voiceprint samples a guest accumulates (from visits) */
const MAX_GUEST_SAMPLES = 12;
/** Two guest profiles this similar are the same person: merge them */
const MERGE_THRESHOLD = 0.6;
/** An owner introduction ("meet my sister Sarah") names the next new voice within this window */
const PENDING_INTRO_MS = 2 * 60_000;
const UTTERANCE_WINDOW_MS = 9000;
/** When the user talked over Jarvis: how far back to take audio, overlap included */
const OVERLAP_WINDOW_MS = 4000;

// ---------------------------------------------------------------------------
// Introductions. Deliberately strict: a wrong name is worse than none.
// ---------------------------------------------------------------------------
const NAME = "([A-Za-z][A-Za-z'-]{1,19})";
/** "my name is Sarah", "my name's Sarah", "call me Sarah": any case */
const MY_NAME_PATTERNS = [new RegExp(`\\bmy name(?:'s| is)\\s+${NAME}\\b`, 'i'), new RegExp(`\\b(?:you can )?call me\\s+${NAME}\\b`, 'i')];
/**
 * "I'm Sarah" / "it's Sarah" / "this is Sarah" only at the start of the utterance (after an optional
 * greeting and "Jarvis"), followed by the end or a pause, and only if the name is capitalized
 * (speech recognition capitalizes names, not words like "hungry").
 */
const IM_NAME_PATTERN = new RegExp(
  `^\\s*(?:(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening))[,!.\\s]+)?(?:jarvis[,!.\\s]+)?(?:i'm|i am|it's|it is|this is)\\s+${NAME}(?=\\s*(?:[.,!?]|$|(?:here|and|nice|pleased|good|from)\\b))`,
  'i'
);
/** The owner introducing someone: "this is my sister Sarah", "meet my friend Sarah" */
const INTRODUCE_OTHER_PATTERN = new RegExp(
  `\\b(?:this is|meet|say (?:hi|hello) to)\\s+my\\s+(?:\\w+\\s+)?(?:sister|brother|friend|wife|husband|mom|mum|mother|dad|father|cousin|colleague|partner|girlfriend|boyfriend|fianc[eé]e?|son|daughter|aunt|uncle|grandma|grandpa|grandmother|grandfather|niece|nephew|neighbou?r|roommate|boss)\\s*,?\\s+${NAME}\\b`,
  'i'
);
const NOT_NAMES = new Set(
  (
    'jarvis friday computer sir madam here there back home ready done fine good great ok okay sure sorry ' +
    'not just going trying looking leaving listening coming hungry tired busy bored cold hot sick late early ' +
    'so very really also still the a an my your his her our their this that it in on at to from with for ' +
    'out off up down over all one two yes no well right new old glad happy sad excited curious afraid'
  ).split(' ')
);

function validName(raw: string | undefined, requireCapital: boolean): string | null {
  if (!raw) return null;
  const word = raw.replace(/['-]+$/, '');
  if (word.length < 2 || NOT_NAMES.has(word.toLowerCase())) return null;
  if (requireCapital && !/^[A-Z]/.test(word)) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Who the speaker says they are, and whom they're introducing (if anyone). */
export function parseIntroduction(transcript: string): { self: string | null; other: string | null } {
  let self: string | null = null;
  for (const re of MY_NAME_PATTERNS) {
    self = validName(transcript.match(re)?.[1], false);
    if (self) break;
  }
  if (!self) self = validName(transcript.match(IM_NAME_PATTERN)?.[1], true);
  const other = validName(transcript.match(INTRODUCE_OTHER_PATTERN)?.[1], false);
  return { self, other };
}

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
  /** The guest currently talking to Jarvis (their follow-ups strengthen their voiceprint) */
  private activeVisit: { id: string; lastAt: number } | null = null;
  private pendingIntro: { name: string; at: number } | null = null;
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
  private captureUtterance(): { samples: Float32Array; overlapped: Float32Array; sampleRate: number } {
    const now = Date.now();
    const jarvis = this.getJarvisIntervals();
    const lastJarvisEnd = jarvis.reduce((m, iv) => (iv.end <= now ? Math.max(m, iv.end) : m), 0);
    const from = Math.max(now - UTTERANCE_WINDOW_MS, lastJarvisEnd);
    return {
      samples: voiceCapture.getAudio(from, now, jarvis),
      // If the user talked over Jarvis, most of their words overlap his speech. This version keeps
      // those stretches (the mic's echo cancellation removes much of his voice); the Jarvis
      // voiceprint check then rejects it if it's really him.
      overlapped: voiceCapture.getAudio(now - OVERLAP_WINDOW_MS, now),
      sampleRate: voiceCapture.sampleRate,
    };
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
    const { samples, overlapped, sampleRate } = this.captureUtterance(); // synchronous: before any await

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
      if (!embedding && overlapped.length > samples.length) {
        // Talked over Jarvis: too little clean audio, so use the overlapping stretch
        ({ embedding, seconds } = await this.voiceprintFrom(overlapped, sampleRate));
      }
    } catch (err) {
      console.warn('[VoiceBiometrics] Identification unavailable:', err);
      return this.result(null, 'Unverified', 0, false, 'model-unavailable', 0);
    }
    if (!embedding) return this.result(null, 'Unverified', 0, false, 'too-short', seconds);

    return this.decide(embedding, seconds, spokenTranscript);
  }

  /**
   * Decide who spoke from a voiceprint (also used directly by tests).
   *
   * 1. Matches an enrolled voice (>= 0.50): that person. A visiting guest's sample is added.
   * 2. Continuity: during a guest's visit, their follow-ups are accepted from 0.35 (as long as the
   *    owner isn't plausible) and added to their profile, so one short first sentence grows
   *    into a solid multi-sample voiceprint before they leave.
   * 3. Clearly new (< 0.30, >= 1.5 s): a new guest profile (named from an introduction, or from
   *    the owner's "meet my sister Sarah").
   * 4. Otherwise: unrecognized (guest permissions), nothing learned.
   */
  public decide(embedding: Float32Array, seconds: number, transcript: string): SpeakerIdentificationResult {
    const now = Date.now();
    const scores = new Map<string, number>();
    let best: VoiceProfile | null = null;
    let bestScore = -1;
    for (const p of this.profiles) {
      const score = cosine(embedding, p.centroid);
      scores.set(p.id, score);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const owner = this.getOwnerProfile();
    const ownerScore = owner ? scores.get(owner.id) ?? -1 : -1;

    // Jarvis hearing himself (should be rare now, but never let it act as a person)
    if (this.jarvisVoiceprint) {
      const jarvisScore = cosine(embedding, this.jarvisVoiceprint);
      if (jarvisScore >= JARVIS_ECHO_THRESHOLD && jarvisScore > bestScore) {
        return this.result(null, 'Jarvis (echo)', jarvisScore, false, 'jarvis-echo', seconds);
      }
    }

    const intro = parseIntroduction(transcript);
    if (this.pendingIntro && now - this.pendingIntro.at > PENDING_INTRO_MS) this.pendingIntro = null;
    if (this.activeVisit && now - this.activeVisit.lastAt > VISIT_WINDOW_MS) this.activeVisit = null;

    // 1. A known voice
    if (best && bestScore >= MATCH_THRESHOLD) {
      if (best.isOwner) {
        // The guest's visit continues while the owner joins in (they often take turns)
        if (intro.other) this.pendingIntro = { name: intro.other, at: now };
        this.touch(best, embedding, bestScore, false);
        return { ...this.result(best, best.name, bestScore, true, 'match', seconds), expectingGuest: this.pendingIntro?.name };
      }
      const named = this.maybeName(best, intro.self);
      this.touch(best, embedding, bestScore, true);
      this.activeVisit = { id: best.id, lastAt: now };
      const merged = this.autoMerge(best.id);
      return { ...this.result(merged, merged.name, bestScore, false, 'match', seconds), introducedAs: named ?? undefined };
    }

    // 2. The guest we're already talking to (their profile is still thin)
    if (this.activeVisit && best && best.id === this.activeVisit.id && !best.isOwner && bestScore >= VISIT_CONTINUITY_THRESHOLD && ownerScore < VISIT_OWNER_CEILING) {
      const named = this.maybeName(best, intro.self);
      this.touch(best, embedding, bestScore, true);
      this.activeVisit.lastAt = now;
      const merged = this.autoMerge(best.id);
      return { ...this.result(merged, merged.name, bestScore, false, 'match', seconds), introducedAs: named ?? undefined };
    }

    // 3. A clearly new voice: remember them as a guest
    if (this.isAutoLearnEnabled() && bestScore < NEW_VOICE_THRESHOLD && seconds >= MIN_NEW_VOICE_SECONDS) {
      const name = intro.self || this.pendingIntro?.name || null;
      if (!intro.self && this.pendingIntro) this.pendingIntro = null;
      const guestNumber = this.profiles.filter((p) => !p.isOwner).length + 1;
      const v = round4(embedding);
      const guest: VoiceProfile = {
        id: `voice_guest_${now}_${Math.random().toString(36).slice(2, 6)}`,
        name: name || `Guest #${guestNumber}`,
        isOwner: false,
        isAutoDiscovered: !name,
        enrolledAt: new Date(now).toISOString(),
        lastHeardAt: new Date(now).toISOString(),
        samplesCount: 1,
        model: 'campplus-v1',
        enrollment: [v],
        adaptive: [],
        centroid: v,
      };
      this.profiles.push(guest);
      this.activeVisit = { id: guest.id, lastAt: now };
      this.saveProfiles();
      return {
        ...this.result(guest, guest.name, 1, false, 'no-match', seconds),
        isNewlyDiscovered: true,
        introducedAs: name ?? undefined,
      };
    }

    // 4. Not sure: guest permissions, learn nothing
    return this.result(null, 'Unrecognized Speaker', Math.max(0, bestScore), false, 'no-match', seconds);
  }

  /** Name an auto-discovered guest from their own introduction. Returns the new name, if any. */
  private maybeName(profile: VoiceProfile, name: string | null): string | null {
    // Only auto-named profiles ("Guest #2") are renamed; a deliberate name is never overwritten
    if (!name || profile.isOwner || !profile.isAutoDiscovered) return null;
    profile.name = name;
    profile.isAutoDiscovered = false;
    return name;
  }

  /** Record a recognized utterance; guests also grow their voiceprint from it. */
  private touch(profile: VoiceProfile, embedding: Float32Array, score: number, isGuestVisit: boolean) {
    const v = round4(embedding);
    if (isGuestVisit && profile.enrollment.length < MAX_GUEST_SAMPLES) {
      profile.enrollment = [...profile.enrollment, v];
    } else if (score >= ADAPT_THRESHOLD) {
      profile.adaptive = [...(profile.adaptive || []), v].slice(-MAX_ADAPTIVE);
    }
    profile.centroid = round4(centroidOf([...profile.enrollment, ...(profile.adaptive || [])]));
    profile.lastHeardAt = new Date().toISOString();
    profile.samplesCount = (profile.samplesCount || 0) + 1;
    this.saveProfiles();
  }

  // ---------------------------------------------------------------------------
  // Merging duplicate guests
  // ---------------------------------------------------------------------------

  /**
   * Merge `sourceId` into `targetId`: voiceprint samples and history are combined, the target's
   * name is kept. The owner can be a target (e.g. a duplicate of yourself) but never a source.
   */
  public mergeProfiles(targetId: string, sourceId: string): VoiceProfile | null {
    const target = this.profiles.find((p) => p.id === targetId);
    const source = this.profiles.find((p) => p.id === sourceId);
    if (!target || !source || target === source || source.isOwner) return target ?? null;
    const cap = target.isOwner ? Math.max(target.enrollment.length, 5) : MAX_GUEST_SAMPLES;
    target.enrollment = target.isOwner
      ? target.enrollment // the owner's enrollment stays exactly as recorded
      : [...target.enrollment, ...source.enrollment].slice(-cap);
    target.adaptive = [...(target.adaptive || []), ...(target.isOwner ? source.enrollment : []), ...(source.adaptive || [])].slice(-MAX_ADAPTIVE);
    target.centroid = round4(centroidOf([...target.enrollment, ...target.adaptive]));
    target.samplesCount = (target.samplesCount || 0) + (source.samplesCount || 0);
    if (target.isAutoDiscovered && !source.isAutoDiscovered) {
      target.name = source.name;
      target.isAutoDiscovered = false;
    }
    if (source.lastHeardAt > target.lastHeardAt) target.lastHeardAt = source.lastHeardAt;
    this.profiles = this.profiles.filter((p) => p.id !== sourceId);
    if (this.activeVisit?.id === sourceId) this.activeVisit.id = targetId;
    this.saveProfiles();
    return target;
  }

  /** Two guest profiles that sound like the same person: merge (named / larger one wins). */
  private autoMerge(profileId: string): VoiceProfile {
    let current = this.profiles.find((p) => p.id === profileId)!;
    for (const other of [...this.profiles]) {
      if (other.id === current.id || other.isOwner || current.isOwner) continue;
      if (cosine(current.centroid, other.centroid) < MERGE_THRESHOLD) continue;
      const keepCurrent =
        (!current.isAutoDiscovered && other.isAutoDiscovered) ||
        (current.isAutoDiscovered === other.isAutoDiscovered && current.enrollment.length >= other.enrollment.length);
      current = keepCurrent ? this.mergeProfiles(current.id, other.id)! : this.mergeProfiles(other.id, current.id)!;
    }
    return current;
  }

  /** Profiles that may be the same person as `profileId` (for the merge suggestion in the UI). */
  public similarProfiles(profileId: string): { profile: VoiceProfile; score: number }[] {
    const p = this.profiles.find((x) => x.id === profileId);
    if (!p) return [];
    return this.profiles
      .filter((o) => o.id !== p.id)
      .map((o) => ({ profile: o, score: cosine(p.centroid, o.centroid) }))
      .sort((a, b) => b.score - a.score);
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
