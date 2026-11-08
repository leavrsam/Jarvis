import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArcReactorVisualizer } from './components/ArcReactorVisualizer';
import { TelemetryHUD, WakeWordMode, WakeWordScope } from './components/TelemetryHUD';
import { SubtitlesOverlay, DialogueEntry } from './components/SubtitlesOverlay';
import { checkSession, logout, onAuthRequired } from './services/auth';
import { hudMetrics, logEvent } from './services/eventLog';
import { SecurityGate } from './components/SecurityGate';
import { YouTubeMediaHUD } from './components/YouTubeMediaHUD';
import { ScreenPanel } from './components/ScreenPanel';
import { FollowUpCountdown } from './components/FollowUpCountdown';
import { CalendarCard, ClockCard, NowPlayingCard, SystemCard, WeatherCard } from './components/hud/GlanceColumn';
import { WidgetBoard, useIsWide } from './components/hud/WidgetBoard';
import { NotificationToast } from './components/NotificationToast';
import { onPushNotification, PushNote } from './services/push';
import type { WidgetId } from './services/hudLayout';
import { ConversationPanel } from './components/hud/ConversationPanel';
import { StateCaption } from './components/hud/StateCaption';
import { parseDirective } from './services/directives';
import { applyScreenDirective, subscribeScreen } from './services/screenController';
import { addTimer, cancelTimers, dismissRinging, doneAnnouncement, fireDue, ringingTimers } from './services/timers';
import { isStopCommand } from './services/stopCommand';
import { TimerStack } from './components/hud/TimerStack';
import {
  AirQualityWidget,
  CameraWidget,
  CountdownWidget,
  NotesWidget,
  QuickCommandsWidget,
  SpectrumWidget,
  SunMoonWidget,
  WeekAheadWidget,
  WorldClocksWidget,
} from './components/hud/ExtraWidgets';
import {
  CommuteWidget,
  DeliveriesWidget,
  DoorbellWidget,
  HeadlinesWidget,
  MarketsWidget,
  PhotoFrameWidget,
  ShoppingWidget,
  SmartHomeWidget,
  SportsWidget,
  TasksWidget,
} from './components/hud/MoreWidgets';
import { audioEngine, JarvisAudioState, JarvisNeuralVoicePreset } from './services/audioEngine';
import { streamJarvisCommand, JarvisBackendError } from './services/jarvisBackend';
import { ReplyStreamProcessor } from './services/replyStream';
import { voiceBiometrics } from './services/voiceBiometrics';
import { handleJarvisResponse, duckVolume, restoreVolume } from './services/youtubeController';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useBuiltInListening } from './hooks/useBuiltInListening';
import { getListeningEngine, ListeningEngine, onListeningEngineChange } from './services/listeningEngine';
import { useBatteryStatus } from './hooks/useBatteryStatus';
import { voiceCapture } from './services/speaker/voiceCapture';
import { getReleaseMicWhileSpeaking, onMicSettingsChange } from './services/micSettings';


// Sign-off phrases that gracefully end a multi-turn conversation after Jarvis replies
/** If Jarvis hasn't started talking by now, a soft thinking tone plays until his first word
 *  (it fades out the instant he speaks, so it never delays the answer). Quick replies skip it. */
const THINKING_CUE_DELAY_MS = 600;

// Spoken when the n8n run fails. "partial" = the connection dropped after part of the reply.
function failureMessage(partial: boolean, kind?: string): string {
  if (partial) return 'My apologies, sir. I lost the link to the n8n matrix mid-reply.';
  if (kind === 'rate_limited') return "One moment, sir. You're asking faster than I can keep up.";
  if (kind === 'run_failed') return 'My apologies, sir. That request failed partway through.';
  // Proxy couldn't reach n8n (wrong key, n8n down, timeout) or the connection failed
  return "I can't reach my systems, sir. Please try again in a moment.";
}

const CONVERSATION_END_REGEX = /\b(?:that's all|thats all|that is all|that'll be all|thank you jarvis|thanks jarvis|goodbye|good night|bye jarvis|stop listening|go to sleep|stand by|standby|never ?mind|nothing else|i'm good|im good|i'm done|im done)\b/i;
/** A bare "thanks" / "thank you" / "perfect" as the whole follow-up also ends the conversation */
const CONVERSATION_END_EXACT = /^(?:ok(?:ay)?[, ]*)?(?:thanks|thank you|thanks a lot|cheers|perfect|great|got it|cool|ok|okay|no|nope|no thanks|no thank you)[.!]*$/i;

/** "Stop" and friends, said to a ringing timer */
const TIMER_STOP_REGEX = /^(?:(?:ok(?:ay)?|alright|yes|thanks?|thank you)[,.!\s]+)?(?:stop|dismiss|cancel|silence|quiet|enough|shut up|turn (?:it |that )?off|got it|thanks?|thank you|okay|ok)(?:[,.!\s]+(?:it|that|the timer|the alarm|timer|alarm|please|thanks?|thank you|jarvis))*[.!\s]*$/i;

/**
 * Follow-up window (like Alexa Follow-Up Mode / Google Continued Conversation): how long Jarvis
 * keeps listening without the wake word after a reply. Counted until you START talking.
 */
const FOLLOW_UP_AFTER_QUESTION_MS = 6000;
const FOLLOW_UP_AFTER_STATEMENT_MS = 3000;
/** A follow-up voice scoring below this against every known profile is treated as someone else */
const FOLLOW_UP_STRANGER_SCORE = 0.3;

/** Did the reply end by asking the user something? */
function replyAsksQuestion(text: string): boolean {
  return /\?\s*["'”’)]*\s*$/.test(text.trim());
}

export const App: React.FC = () => {
  // Server-side session (HttpOnly cookie). Checked on load; any protected call answering 401
  // brings the login screen back.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authConfigured, setAuthConfigured] = useState<boolean>(true);
  useEffect(() => {
    let cancelled = false;
    checkSession().then((status) => {
      if (cancelled) return;
      setIsAuthenticated(status.authenticated);
      setAuthConfigured(status.configured);
      setAuthChecked(true);
    });
    // Old client-side passcode cache; no longer used
    try {
      localStorage.removeItem('jarvis_auth_token');
    } catch {}
    return () => {
      cancelled = true;
    };
  }, []);

  // Battery status & Wake Word power profile
  const battery = useBatteryStatus();
  const [wakeWordMode, setWakeWordMode] = useState<WakeWordMode>(() => {
    try {
      const saved = localStorage.getItem('jarvis_wakeword_mode') as WakeWordMode | null;
      if (saved === 'always' || saved === 'off') return saved;
      // Upgrade default and legacy 'charging_only' to 'always' so "Hey Jarvis" works on battery
      return 'always';
    } catch {
      return 'always';
    }
  });

  // Wake Word Scope: 'background' (active + background tabs) vs 'active_only' (active browser window only)
  const [wakeWordScope, setWakeWordScope] = useState<WakeWordScope>(() => {
    try {
      const saved = localStorage.getItem('jarvis_wakeword_scope') as WakeWordScope | null;
      if (saved === 'active_only' || saved === 'background') return saved;
      return 'background';
    } catch {
      return 'background';
    }
  });

  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() =>
    typeof document !== 'undefined' ? !document.hidden : true
  );

  useEffect(() => {
    const handleVisibility = () => {
      setIsDocumentVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', () => setIsDocumentVisible(true));
    window.addEventListener('blur', () => setIsDocumentVisible(!document.hidden));
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const isWakeWordActive = isAuthenticated && (
    wakeWordMode === 'always' ||
    (wakeWordMode === 'charging_only' && battery.charging)
  ) && (
    wakeWordScope === 'background' || isDocumentVisible
  );

  const [audioState, setAudioState] = useState<JarvisAudioState>('idle');
  const [voicePreset, setVoicePreset] = useState<JarvisNeuralVoicePreset>(() => audioEngine.getVoicePreset());
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('All systems operational. Standing by for command.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<DialogueEntry[]>([]);

  // Biometric Speaker Identification State
  const [lastSpeaker, setLastSpeaker] = useState<string>(() => {
    const owner = voiceBiometrics.getOwnerProfile();
    return owner ? owner.name : 'Samuel';
  });
  const [speakerConfidence, setSpeakerConfidence] = useState<number>(0.96);
  const [isOwner, setIsOwner] = useState<boolean>(true);
  const isSpeakingRef = useRef(false);
  /** When "hey Jarvis" silenced a ringing timer (a following "stop" is then for the timer) */
  const timerSilencedAtRef = useRef(0);
  /** Jarvis is busy (talking / listening / thinking): timer announcements wait for a gap */
  const jarvisBusyRef = useRef(false);
  // Tracks whether we are in an active multi-turn dialogue loop
  const inConversationRef = useRef(false);
  const startListeningRef = useRef<(isFollowUp?: boolean, timeoutMs?: number) => void>(() => {});
  /** The last reply's text (decides the follow-up window) */
  const lastReplyRef = useRef('');
  /** A follow-up window is open: the next command may come without "hey Jarvis" */
  const followUpOpenRef = useRef(false);
  /** Who started this conversation (voice ID profile); follow-ups are only taken from them */
  const conversationSpeakerRef = useRef<{ id: string; name: string; isOwner: boolean; confidence: number } | null>(null);
  /** For the on-screen countdown while the follow-up window is open */
  const [followUpWindow, setFollowUpWindow] = useState<{ endsAt: number; totalMs: number } | null>(null);
  // In-flight n8n request, so a new command can cancel it
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // "Stop everything" (Stop button, Esc, or saying "stop"). Set once the listening engines exist.
  const stopEverythingRef = useRef<(why: string) => void>(() => {});

  // Cancel the reply in progress: abort the fetch, stop audio and drop queued sentences
  const interruptCurrentReply = useCallback(() => {
    requestIdRef.current++;
    if (requestAbortRef.current) {
      requestAbortRef.current.abort();
      requestAbortRef.current = null;
    }
    audioEngine.stopSpeaking();
    setIsProcessing(false);
  }, []);

  // Timers: ring when due (chime + "Sir, your pasta timer is done"), repeating every 30 s until
  // dismissed. End times are absolute, so they keep time whatever else is going on; the spoken
  // reminder waits for a moment when Jarvis isn't talking, listening or thinking.
  useEffect(() => {
    jarvisBusyRef.current = audioState !== 'idle' || isProcessing;
  }, [audioState, isProcessing]);
  useEffect(() => {
    if (!isAuthenticated) return;
    let nextAnnounceAt = 0;
    const tick = () => {
      const now = Date.now();
      const fresh = fireDue(now);
      if (fresh.length) {
        audioEngine.playSfx('timer');
        logEvent('command', `Timer done: ${fresh.map((t) => t.label).join(', ')}`);
        nextAnnounceAt = now;
      }
      const ringing = ringingTimers();
      if (!ringing.length) {
        nextAnnounceAt = 0;
        return;
      }
      if (now < nextAnnounceAt || jarvisBusyRef.current) return;
      nextAnnounceAt = now + 30_000;
      if (!fresh.length) audioEngine.playSfx('timer');
      const text = doneAnnouncement(ringing.map((t) => t.label));
      logEvent('command', `Timer reminder: "${text}"`);
      void audioEngine.speak(
        text,
        () => setAudioState('speaking'),
        () => setAudioState('idle')
      );
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [isAuthenticated]);

  // HUD screen up: the reactor moves aside on wide displays
  const [screenActive, setScreenActive] = useState(false);
  // Widget layout: wide screens place widgets freely, phones stack them under the voice screen
  const isWide = useIsWide();
  const [editingLayout, setEditingLayout] = useState(false);
  useEffect(() => {
    const toggle = () => setEditingLayout((v) => !v);
    window.addEventListener('jarvis:edit-layout', toggle);
    return () => window.removeEventListener('jarvis:edit-layout', toggle);
  }, []);
  const stopEditingLayout = useCallback(() => setEditingLayout(false), []);
  const editingLayoutRef = useRef(false);
  editingLayoutRef.current = editingLayout;
  // Push notifications that arrive while Jarvis is open
  const [toast, setToast] = useState<PushNote | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  useEffect(() => subscribeScreen((st) => setScreenActive(Boolean(st.content))), []);

  // Sync speaking state & handle intelligent YouTube audio ducking
  useEffect(() => {
    isSpeakingRef.current = audioState === 'speaking';
    if (audioState === 'speaking' || audioState === 'listening' || isProcessing) {
      duckVolume(20);
    } else if (audioState === 'idle') {
      restoreVolume();
    }
  }, [audioState, isProcessing]);

  // Request notification permission when wake word is enabled
  useEffect(() => {
    if (isWakeWordActive) {
      audioEngine.requestNotificationPermission();
    }
  }, [isWakeWordActive]);

  // Update browser tab title dynamically so user can monitor status across windows
  useEffect(() => {
    if (!isAuthenticated) {
      document.title = 'J.A.R.V.I.S. // Security Locked';
      return;
    }
    if (audioState === 'listening') {
      document.title = '[● LISTENING] J.A.R.V.I.S.';
    } else if (audioState === 'processing') {
      document.title = '[⏳ PROCESSING] J.A.R.V.I.S.';
    } else if (audioState === 'speaking') {
      document.title = '[▶ SPEAKING] J.A.R.V.I.S.';
    } else if (isWakeWordActive) {
      document.title = '[⚡ "HEY JARVIS"] J.A.R.V.I.S.';
    } else {
      document.title = 'J.A.R.V.I.S. // Autonomous Sci-Fi HUD';
    }
  }, [isAuthenticated, audioState, isWakeWordActive]);

  // Helper to transition back into follow-up listening after Jarvis finishes speaking
  const resumeFollowUpListening = useCallback(async () => {
    if (!inConversationRef.current) {
      setAudioState('idle');
      return;
    }
    await audioEngine.startMicListening();
    setAudioState('listening');
    // (+0.7 s when the mic was closed while Jarvis talked and is only now reopening, e.g. Android)
    const windowMs =
      (replyAsksQuestion(lastReplyRef.current) ? FOLLOW_UP_AFTER_QUESTION_MS : FOLLOW_UP_AFTER_STATEMENT_MS) +
      (voiceCapture.isRunning() ? 0 : 700);
    followUpOpenRef.current = true;
    setFollowUpWindow({ endsAt: Date.now() + windowMs, totalMs: windowMs });
    startListeningRef.current(true, windowMs);
  }, []);

  // Execute Backend Dispatch to n8n Webhook with Biometric Speaker Metadata
  const handleCommandSubmit = useCallback(async (query: string, source: 'voice' | 'typed' = 'voice', meta?: { wakeWord: boolean }) => {
    if (!query || query.trim().length === 0) return;
    // A follow-up: spoken in the follow-up window without "hey Jarvis"
    const isFollowUp = source === 'voice' && followUpOpenRef.current && !meta?.wakeWord;
    followUpOpenRef.current = false;
    setFollowUpWindow(null);

    const trimmedQuery = query.trim();

    // "Stop" / "Jarvis, stop" / "cancel" / "never mind" as the whole command: just stop, no reply,
    // nothing sent to n8n (also silences a ringing timer)
    if (isStopCommand(trimmedQuery)) {
      timerSilencedAtRef.current = 0;
      stopEverythingRef.current(`said "${trimmedQuery}"`);
      return;
    }

    // "Hey Jarvis, stop" while a timer rings (or just after "hey Jarvis" silenced it): that's
    // for the timer, not a question for n8n
    if (
      (ringingTimers().length > 0 || Date.now() - timerSilencedAtRef.current < 15_000) &&
      TIMER_STOP_REGEX.test(trimmedQuery)
    ) {
      const n = dismissRinging();
      timerSilencedAtRef.current = 0;
      logEvent('command', `"${trimmedQuery}": timer dismissed${n ? '' : ' (already silenced)'}`);
      inConversationRef.current = false;
      setAudioState('idle');
      return;
    }
    // Record user prompt for HUD attribution
    setLastQuery(trimmedQuery);

    // Voice ID: the utterance audio is grabbed right now (synchronously, from the rolling mic
    // buffer); the voiceprint is computed while the UI switches to "processing" below.
    const speakerPromise = voiceBiometrics.identifySpeaker(trimmedQuery, source);

    // Check if the user is signing off ("That's all, thanks Jarvis")
    if (CONVERSATION_END_REGEX.test(trimmedQuery) || CONVERSATION_END_EXACT.test(trimmedQuery)) {
      inConversationRef.current = false;
    } else {
      inConversationRef.current = true;
    }

    // A new command replaces any reply still streaming or being spoken
    interruptCurrentReply();

    // Stop mic listening while processing and speaking
    audioEngine.stopMicListening();
    audioEngine.setState('processing');
    setAudioState('processing');
    setIsProcessing(true);
    audioEngine.playSfx('processing');

    const requestId = requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const t0 = performance.now();

    let speakerResult = await speakerPromise;
    const voiceIdMs = Math.round(performance.now() - t0);
    // A follow-up too short for voice ID ("What?", "Thanks") continues the conversation of
    // whoever started it, instead of showing as "Unverified"
    const convoSpeaker = conversationSpeakerRef.current;
    if (isFollowUp && convoSpeaker && speakerResult.reason === 'too-short') {
      logEvent('voice-id', `Too short to check (${speakerResult.speechSeconds}s); continuing ${convoSpeaker.name}'s conversation`);
      speakerResult = { ...speakerResult, name: convoSpeaker.name, isOwner: convoSpeaker.isOwner, confidence: convoSpeaker.confidence };
    }
    if (!isCurrent()) return;
    setLastSpeaker(speakerResult.name);
    hudMetrics.speaker = speakerResult.name;
    hudMetrics.speakerScore = speakerResult.confidence;
    setSpeakerConfidence(speakerResult.confidence);
    setIsOwner(speakerResult.isOwner);
    logEvent(
      'voice-id',
      `${speakerResult.name}${speakerResult.isOwner ? ' (owner)' : ''} · score ${speakerResult.confidence.toFixed(2)} · ${speakerResult.reason} · ${speakerResult.speechSeconds}s speech · "${trimmedQuery.slice(0, 40)}"`
    );
    console.info(
      `[VoiceID] ${speakerResult.name} owner=${speakerResult.isOwner} score=${speakerResult.confidence} reason=${speakerResult.reason} speech=${speakerResult.speechSeconds}s (${Math.round(performance.now() - t0)}ms)`
    );

    // Jarvis's own voice: never act on it
    if (speakerResult.reason === 'jarvis-echo') {
      setIsProcessing(false);
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
      void resumeFollowUpListening();
      return;
    }

    // Follow-ups are only taken from the person who started the conversation (friends chatting
    // nearby shouldn't be answered). Uncertain voice ID gives the benefit of the doubt.
    if (source === 'voice') {
      const heardId = speakerResult.reason === 'match' ? speakerResult.matchedProfile?.id ?? null : null;
      const convo = conversationSpeakerRef.current;
      // Different person = voice ID matched someone else, or the voice is clearly unlike anyone
      // known. A weak score (e.g. 0.47 on a different mic) is NOT enough: that's often the owner.
      const differentPerson =
        isFollowUp &&
        convo !== null &&
        ((heardId !== null && heardId !== convo.id) ||
          (speakerResult.reason === 'no-match' && speakerResult.confidence < FOLLOW_UP_STRANGER_SCORE && speakerResult.speechSeconds >= 1.5));
      if (differentPerson) {
        logEvent('voice-id', `Follow-up ignored: ${speakerResult.name} isn't ${convo!.name}, who started this conversation ("${trimmedQuery.slice(0, 40)}")`);
        inConversationRef.current = false;
        setIsProcessing(false);
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
        audioEngine.setState('idle');
        setAudioState('idle');
        return;
      }
      // A new conversation (wake word) records who started it
      if (!isFollowUp) {
        conversationSpeakerRef.current = heardId
          ? { id: heardId, name: speakerResult.name, isOwner: speakerResult.isOwner, confidence: speakerResult.confidence }
          : null;
      }
    }

    // Owner gate: only verified owner voice commands are carried out
    if (source === 'voice' && voiceBiometrics.isOwnerGateEnabled() && !speakerResult.isOwner) {
      setIsProcessing(false);
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
      const ownerName = voiceBiometrics.getOwnerProfile()?.name || 'the owner';
      const refusal =
        speakerResult.reason === 'too-short'
          ? "I didn't quite catch your voice, sir. Could you say that again?"
          : `My apologies. I'm only taking instructions from ${ownerName} at the moment.`;
      setLastResponse(refusal);
      lastReplyRef.current = refusal;
      audioEngine.setState('speaking');
      setAudioState('speaking');
      await audioEngine.speak(refusal, undefined, () => {
        if (isCurrent()) void resumeFollowUpListening();
      });
      return;
    }

    // If the reply isn't playing yet after a moment, a soft thinking tone lets you know he's on it;
    // it stops the instant his first word plays (or the request ends / is interrupted)
    const cueTimer = setTimeout(() => {
      if (isCurrent()) audioEngine.startThinkingCue();
    }, THINKING_CUE_DELAY_MS);
    const stopCue = () => {
      clearTimeout(cueTimer);
      audioEngine.stopThinkingCue();
    };

    // Sentences are spoken as soon as each one is complete, back-to-back
    const speech = audioEngine.createSpeechQueue(
      () => {
        if (!isCurrent()) return;
        stopCue();
        firstAudioMs = Math.round(performance.now() - t0);
        hudMetrics.firstAudioMs = firstAudioMs;
        hudMetrics.brainMs = firstTextMs ?? 0;
        hudMetrics.at = Date.now();
        console.info(`[Jarvis] first audio after ${firstAudioMs}ms`);
        logEvent('command', `Timing: voice ID ${voiceIdMs} ms · first text ${firstTextMs ?? '?'} ms · first audio ${firstAudioMs} ms (from your command)`);
        audioEngine.setState('speaking');
        setAudioState('speaking');
      },
      () => {
        stopCue(); // the reply finished (or couldn't be voiced): never leave the tone running
        // Automatically re-open mic for seamless multi-turn back-and-forth dialogue
        if (isCurrent()) void resumeFollowUpListening();
      }
    );

    let gotText = false;
    let firstTextMs: number | null = null;
    let firstAudioMs: number | null = null;
    const reply = new ReplyStreamProcessor({
      // Directives (PLAY_YOUTUBE: <id>, SHOW_IMAGE_SEARCH: <what>, CLEAR_SCREEN, ...) are executed, never spoken
      onDirective: (directive) => {
        const parsed = parseDirective(directive);
        if (parsed?.type === 'set-timer') {
          addTimer(parsed.seconds, parsed.label);
          logEvent('command', `Timer: ${parsed.label} for ${parsed.seconds} s`);
          return;
        }
        if (parsed?.type === 'cancel-timer') {
          const n = cancelTimers(parsed.label);
          logEvent('command', `Timer cancelled: ${parsed.label} (${n} removed)`);
          return;
        }
        if (!parsed && /^(?:SET|CANCEL)_TIMER/i.test(directive.trim())) {
          logEvent('command', `Ignored timer directive (needs whole seconds, up to a day): ${directive.slice(0, 80)}`);
          return;
        }
        if (parsed && applyScreenDirective(parsed)) {
          logEvent('command', `Screen: ${directive.slice(0, 80)}`);
          return;
        }
        if (!parsed && /^SHOW_(?:IMAGE|VIDEO|CAMERA)/i.test(directive.trim())) {
          logEvent('command', `Ignored screen directive (needs an https URL / valid camera name): ${directive.slice(0, 80)}`);
          return;
        }
        handleJarvisResponse(directive);
      },
      onSentence: (sentence) => speech.enqueue(sentence),
      onDisplay: (text) => {
        if (!gotText && text) {
          gotText = true;
          setIsProcessing(false);
          audioEngine.playSfx('response');
        }
        setLastResponse(text);
      },
    });

    let failed = false;
    let connectionDropped = false;
    let failureKind: string = 'unreachable';
    try {
      // POST enriched payload with speaker attribution to n8n webhook; text streams in via onText
      await streamJarvisCommand(
        {
          query: trimmedQuery,
          sessionId: 'jarvis-web',
          speaker: speakerResult.name,
          speakerConfidence: speakerResult.confidence,
          isAuthorizedOwner: speakerResult.isOwner,
        },
        {
          signal: controller.signal,
          onText: (delta) => {
            if (!isCurrent()) return;
            if (firstTextMs === null) firstTextMs = Math.round(performance.now() - t0);
            reply.push(delta);
          },
        }
      );
    } catch (err) {
      if (controller.signal.aborted || !isCurrent()) {
        stopCue();
        return; // interrupted by the user; the new command takes over
      }
      failed = true;
      // JarvisBackendError = the run failed (HTTP error / unanswered error event); anything else = link dropped
      connectionDropped = !(err instanceof JarvisBackendError);
      failureKind = err instanceof JarvisBackendError ? err.kind : 'unreachable';
      console.warn('[Jarvis] Reply failed:', err);
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
    }
    if (!isCurrent()) {
      stopCue();
      return;
    }

    // Flush whatever is left of the reply (the last sentence may have no trailing space)
    reply.end();
    const finalText = reply.displayText;
    if (!finalText) stopCue(); // nothing to say (e.g. only a screen directive)
    lastReplyRef.current = finalText;
    if (firstAudioMs === null && firstTextMs !== null) logEvent('command', `Timing: voice ID ${voiceIdMs} ms · first text ${firstTextMs} ms (from your command)`);

    if (failed) {
      audioEngine.playSfx('error');
      const errText = failureMessage(connectionDropped && finalText.length > 0, failureKind);
      const shown = finalText ? `${finalText}\n${errText}` : errText;
      setLastResponse(shown);
      speech.enqueue(errText);
    }
    setIsProcessing(false);
    if (!gotText && !failed) audioEngine.playSfx('response');

    setHistory(prev => [
      {
        query: trimmedQuery,
        response: failed ? (finalText ? `${finalText} [interrupted by error]` : 'Error: n8n link failed') : finalText,
        timestamp: new Date(),
        speaker: speakerResult.name,
        speakerConfidence: speakerResult.confidence,
      },
      ...prev,
    ]);

    // Voice ID learned a name from this command: confirm it out loud, after the reply
    if (!failed && speakerResult.introducedAs) {
      speech.enqueue(`Lovely to meet you, ${speakerResult.introducedAs}. I'll remember your voice.`);
    } else if (!failed && speakerResult.expectingGuest) {
      speech.enqueue(`I'll remember ${speakerResult.expectingGuest}'s voice once I hear it.`);
    }

    speech.finish();
    await speech.done;
  }, [resumeFollowUpListening, interruptCurrentReply]);

  // Handler for Wake Word ("Hey Jarvis" / "Jarvis") trigger
  const handleWakeWordDetected = useCallback(async (trailingQuery?: string) => {
    if (!isAuthenticated) return;
    if (dismissRinging()) {
      timerSilencedAtRef.current = Date.now();
      logEvent('command', 'Timer silenced by "hey Jarvis"');
    }
    followUpOpenRef.current = false;
    setFollowUpWindow(null);

    inConversationRef.current = true;
    interruptCurrentReply();
    audioEngine.ensureContext();
    audioEngine.playSfx('wake');
    // Warm up the TTS function while the user is still speaking
    audioEngine.prewarm();

    // Notify if running in background
    if (document.hidden) {
      audioEngine.notifyWake(trailingQuery ? `Ingested: "${trailingQuery}"` : 'Listening for your instructions, sir.');
    }

    // Couple microphone stream to reactive visualizer
    await audioEngine.startMicListening();
    setAudioState('listening');

    if (trailingQuery && trailingQuery.length > 1) {
      // User spoke command immediately with the wake word (e.g. "Hey Jarvis what is the weather?")
      // Recognition hook already captured trailingQuery into transcript
    } else {
      setLastResponse('Listening, sir...');
    }
  }, [isAuthenticated, interruptCurrentReply]);

  // Hands-Free Vocal Interruption / Barge-In Handler (Triggered while Jarvis is actively speaking)
  const handleBargeIn = useCallback(async (trailingQuery?: string) => {
    if (!isAuthenticated) return;
    if (dismissRinging()) {
      timerSilencedAtRef.current = Date.now();
      logEvent('command', 'Timer silenced by "hey Jarvis"');
    }
    followUpOpenRef.current = false;
    setFollowUpWindow(null);

    // Immediately kill TTS audio playback, the queued sentences and the in-flight n8n request
    interruptCurrentReply();
    inConversationRef.current = true;
    audioEngine.playSfx('wake');

    // Instantly transition to listening
    await audioEngine.startMicListening();
    setAudioState('listening');

    if (trailingQuery && trailingQuery.length > 1) {
      setLastResponse('Standing by, sir...');
    }
  }, [isAuthenticated, interruptCurrentReply]);

  const handleFollowUpTimeout = useCallback(() => {
    const wasFollowUp = followUpOpenRef.current;
    followUpOpenRef.current = false;
    setFollowUpWindow(null);
    if (wasFollowUp) audioEngine.playSfx('standby'); // the window closed: say "hey Jarvis" next time
    inConversationRef.current = false;
    audioEngine.stopMicListening();
    setAudioState('idle');
  }, []);

  // Listening: the built-in engine ("hey Jarvis" on device + Deepgram, one shared mic) or the
  // browser's speech recognizer. Same interface; only the selected one runs.
  const [listeningEngine, setListeningEngineState] = useState<ListeningEngine>(() => getListeningEngine());
  const [builtInUnavailable, setBuiltInUnavailable] = useState(false);
  useEffect(() => onListeningEngineChange(() => {
    setBuiltInUnavailable(false);
    setListeningEngineState(getListeningEngine());
  }), []);
  const builtInEnabled = isAuthenticated && listeningEngine === 'builtin' && !builtInUnavailable;
  const listeningOptions = {
    onFinalSubmit: (query: string, meta?: { wakeWord: boolean }) => handleCommandSubmit(query, 'voice', meta),
    onWakeWordDetected: handleWakeWordDetected,
    onFollowUpTimeout: handleFollowUpTimeout,
    onBargeIn: handleBargeIn,
    silenceTimeoutMs: 750,
    followUpTimeoutMs: FOLLOW_UP_AFTER_STATEMENT_MS, // per window: see resumeFollowUpListening
    // 'processing' also covers the gap between the first streamed text and the first audio
    isJarvisSpeaking: audioState === 'speaking' || audioState === 'processing' || isProcessing || !isAuthenticated,
    // Only while his voice actually plays: while he's silently thinking, plain "Jarvis, stop" works
    isJarvisTalking: audioState === 'speaking' || !isAuthenticated,
    currentJarvisSpeech: audioState === 'speaking' ? lastResponse : '',
    wakeWordEnabled: isWakeWordActive,
    getEchoReference: (tailMs?: number) => audioEngine.getEchoReference(tailMs),
  };
  const browserListening = useSpeechRecognition({ ...listeningOptions, disabled: builtInEnabled });
  const builtInListening = useBuiltInListening({
    ...listeningOptions,
    enabled: builtInEnabled,
    onUnavailable: (reason) => {
      // Fall back to the browser recognizer for this session (if the browser has one)
      logEvent('wake', `Built-in listener unavailable (${reason}); using the browser recognizer`);
      setBuiltInUnavailable(true);
    },
  });
  const { isListening, transcript, interimTranscript, startListening, stopListening, cancelListening } = builtInEnabled
    ? builtInListening
    : browserListening;

  /**
   * Stop whatever Jarvis is doing, at any step: listening (what was heard is thrown away),
   * thinking (the n8n request is cancelled), talking (voice and queued sentences cut), a ringing
   * timer, the follow-up window. No reply; back to standby (the wake word still works). Music
   * isn't touched: "stop the music" is a request like any other.
   */
  const stopEverything = useCallback(
    (why: string) => {
      followUpOpenRef.current = false;
      setFollowUpWindow(null);
      inConversationRef.current = false;
      interruptCurrentReply(); // n8n request, voice, queued sentences, thinking tone
      const timers = dismissRinging();
      cancelListening();
      audioEngine.stopMicListening();
      audioEngine.setState('idle');
      setAudioState('idle');
      setIsProcessing(false);
      logEvent('command', `Stopped (${why})${timers ? `; ${timers} timer${timers > 1 ? 's' : ''} silenced` : ''}`);
    },
    [interruptCurrentReply, cancelListening]
  );
  stopEverythingRef.current = stopEverything;
  /** Anything to stop right now (shows the Stop button) */
  const jarvisActive = isListening || audioState !== 'idle' || isProcessing || ringingTimers().length > 0;

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Manual Push-to-Talk or Hotkey Toggle
  const handleToggleListening = useCallback(async () => {
    if (!isAuthenticated) return;
    // Starting or stopping by hand is never a follow-up
    followUpOpenRef.current = false;
    setFollowUpWindow(null);
    audioEngine.ensureContext();

    // If Jarvis is speaking or still fetching a reply, pressing Space / clicking the orb interrupts him and starts listening immediately!
    if (audioState === 'speaking' || isProcessing || requestAbortRef.current) {
      inConversationRef.current = true;
      interruptCurrentReply();
      audioEngine.playSfx('activate');
      await audioEngine.startMicListening();
      startListening(false);
      setAudioState('listening');
      return;
    }

    if (isListening) {
      inConversationRef.current = false;
      stopListening();
      audioEngine.stopMicListening();
      setAudioState('idle');
    } else {
      inConversationRef.current = true;
      audioEngine.playSfx('activate');
      await audioEngine.startMicListening();
      startListening(false);
      setAudioState('listening');
    }
  }, [isAuthenticated, audioState, isProcessing, isListening, startListening, stopListening, interruptCurrentReply]);

  // Global Hotkey Listener: Spacebar, Option+Space, Cmd+Shift+J
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      // Esc: stop everything (the layout editor uses Esc itself)
      if (e.key === 'Escape' && !editingLayoutRef.current) {
        stopEverythingRef.current('Esc');
        return;
      }
      if (isInput) return;

      // 1. Plain Spacebar push-to-talk / toggle
      if (e.code === 'Space' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleToggleListening();
        return;
      }

      // 2. Option + Space (Mac quick-action hotkey)
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        handleToggleListening();
        return;
      }

      // 3. Cmd/Ctrl + Shift + J
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyJ') {
        e.preventDefault();
        handleToggleListening();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, handleToggleListening]);

  // Sync audioState when SpeechRecognition terminates
  useEffect(() => {
    if (!isListening && audioState === 'listening') {
      setAudioState('idle');
      audioEngine.stopMicListening();
    }
  }, [isListening, audioState]);

  // Cycle Wake-Word Power Profiles: charging_only -> always -> off
  const handleToggleWakeWordMode = useCallback(() => {
    setWakeWordMode(prev => {
      let next: WakeWordMode = 'charging_only';
      if (prev === 'charging_only') next = 'always';
      else if (prev === 'always') next = 'off';
      else next = 'charging_only';

      try {
        localStorage.setItem('jarvis_wakeword_mode', next);
      } catch {}
      audioEngine.playSfx('activate');
      return next;
    });
  }, []);

  // Toggle Wake-Word Scope: 'background' <-> 'active_only'
  const handleToggleWakeWordScope = useCallback(() => {
    setWakeWordScope(prev => {
      const next: WakeWordScope = prev === 'background' ? 'active_only' : 'background';
      try {
        localStorage.setItem('jarvis_wakeword_scope', next);
      } catch {}
      audioEngine.playSfx('activate');
      return next;
    });
  }, []);

  // Voice Test Action
  const handleVoiceTest = useCallback(() => {
    inConversationRef.current = false;
    audioEngine.ensureContext();
    audioEngine.playSfx('activate');
    const greeting = 'Good evening, sir. All core systems are calibrated and standing by for instructions.';
    setLastResponse(greeting);
    setAudioState('speaking');
    audioEngine.speak(
      greeting,
      () => setAudioState('speaking'),
      () => setAudioState('idle')
    );
  }, []);

  const handleVoicePreview = useCallback((text: string) => {
    inConversationRef.current = false;
    audioEngine.ensureContext();
    setLastResponse(text);
    setAudioState('speaking');
    audioEngine.speak(
      text,
      () => setAudioState('speaking'),
      () => setAudioState('idle')
    );
  }, []);

  const handleSelectVoicePreset = useCallback((preset: JarvisNeuralVoicePreset) => {
    inConversationRef.current = false;
    const updated = audioEngine.setVoicePreset(preset.id);
    setVoicePreset(updated);
    audioEngine.playSfx('activate');
    const sample = 'At your service, sir. Vocal parameters recalibrated.';
    setLastResponse(sample);
    audioEngine.speak(
      sample,
      () => setAudioState('speaking'),
      () => setAudioState('idle')
    );
  }, []);

  const handleReplay = useCallback((text: string) => {
    inConversationRef.current = false;
    audioEngine.speak(
      text,
      () => setAudioState('speaking'),
      () => setAudioState('idle')
    );
  }, []);

  const handleStopSpeaking = useCallback(() => stopEverything('Stop button'), [stopEverything]);

  // Lock Console action: ends the server session on this device
  const handleLockConsole = useCallback(() => {
    inConversationRef.current = false;
    stopListening();
    audioEngine.stopMicListening();
    interruptCurrentReply();
    setAudioState('idle');
    setIsAuthenticated(false);
    void logout();
  }, [stopListening, interruptCurrentReply]);

  // Voice ID: rolling mic buffer + model preload while unlocked; Jarvis's own speech is excluded
  useEffect(() => {
    if (!isAuthenticated) return;
    void voiceBiometrics.activate(() => audioEngine.getJarvisIntervals());
    return () => voiceBiometrics.deactivate();
  }, [isAuthenticated]);

  // Android call-mode workaround: close the mic while Jarvis answers so his voice plays through
  // the normal output (the TV on DeX) instead of the phone's speaker; reopen it when he's done
  const [releaseMic, setReleaseMic] = useState(() => getReleaseMicWhileSpeaking());
  useEffect(() => onMicSettingsChange(() => setReleaseMic(getReleaseMicWhileSpeaking())), []);
  const jarvisBusy = audioState === 'speaking' || audioState === 'processing' || isProcessing;
  useEffect(() => {
    if (!isAuthenticated || !releaseMic) return;
    if (jarvisBusy) {
      voiceCapture.release();
      audioEngine.stopMicListening();
      // Once Android has left call mode, the next sound opens a fresh playback output so the
      // reply plays as media (the TV), not through the call route the old output was opened on
      audioEngine.scheduleOutputReset(250);
    } else {
      audioEngine.cancelOutputReset();
      if (!voiceBiometrics.isMicPaused()) void voiceCapture.start();
    }
  }, [isAuthenticated, releaseMic, jarvisBusy]);

  // Session expired or revoked while running: back to the login screen
  useEffect(
    () =>
      onAuthRequired(() => {
        inConversationRef.current = false;
        stopListening();
        audioEngine.stopMicListening();
        interruptCurrentReply();
        setAudioState('idle');
        setIsAuthenticated(false);
      }),
    [stopListening, interruptCurrentReply]
  );

  // Show notifications that arrive while Jarvis is open; read them out if asked ("speak": true)
  // and Jarvis isn't busy talking, listening or thinking
  const busyRef = useRef(false);
  const spokenNotesRef = useRef<{ key: string; at: number }[]>([]);
  busyRef.current = audioState !== 'idle' || isProcessing || isListening;
  useEffect(
    () =>
      onPushNotification((note) => {
        setToast(note);
        if (!note.speak || busyRef.current) return;
        const text = note.body ? `${note.title}. ${note.body}` : note.title;
        // Never let a chatty workflow turn Jarvis into a loudspeaker: the same text is read at
        // most once per 10 minutes, and at most 6 notifications an hour (banners still show)
        const now = Date.now();
        const recent = spokenNotesRef.current.filter((n) => now - n.at < 60 * 60_000);
        const key = text.trim().toLowerCase();
        if (recent.some((n) => n.key === key && now - n.at < 10 * 60_000) || recent.length >= 6) {
          logEvent('command', `Notification not read aloud (repeat or too many this hour): "${note.title}"`);
          spokenNotesRef.current = recent;
          return;
        }
        spokenNotesRef.current = [...recent, { key, at: now }];
        audioEngine.speak(text, () => setAudioState('speaking'), () => setAudioState('idle'));
      }),
    []
  );

  if (!authChecked) {
    return <main className="w-full h-[100dvh] bg-[#02040a] hud-grid" aria-busy="true" />;
  }

  // Render the login screen if there's no valid session
  if (!isAuthenticated) {
    return <SecurityGate onUnlock={() => setIsAuthenticated(true)} serverConfigured={authConfigured} />;
  }

  const renderWidget = (id: WidgetId, editing: boolean) => {
    switch (id) {
      case 'clock':
        return <ClockCard name={voiceBiometrics.getOwnerProfile()?.name} />;
      case 'weather':
        return <WeatherCard />;
      case 'calendar':
        return <CalendarCard />;
      case 'nowPlaying':
        return <NowPlayingCard showIdle={editing} />;
      case 'camera':
        return <CameraWidget />;
      case 'quickCommands':
        return <QuickCommandsWidget onSend={(text) => handleCommandSubmit(text, 'typed')} />;
      case 'worldClocks':
        return <WorldClocksWidget />;
      case 'airQuality':
        return <AirQualityWidget />;
      case 'sunMoon':
        return <SunMoonWidget />;
      case 'weekAhead':
        return <WeekAheadWidget />;
      case 'countdown':
        return <CountdownWidget />;
      case 'notes':
        return <NotesWidget />;
      case 'spectrum':
        return <SpectrumWidget state={audioState} isListening={isListening} />;
      case 'shopping':
        return <ShoppingWidget />;
      case 'tasks':
        return <TasksWidget />;
      case 'smartHome':
        return <SmartHomeWidget />;
      case 'deliveries':
        return <DeliveriesWidget />;
      case 'doorbell':
        return <DoorbellWidget />;
      case 'photoFrame':
        return <PhotoFrameWidget />;
      case 'headlines':
        return <HeadlinesWidget />;
      case 'markets':
        return <MarketsWidget />;
      case 'sports':
        return <SportsWidget />;
      case 'commute':
        return <CommuteWidget />;
      case 'system':
        return (
          <SystemCard
            audioState={audioState}
            isListening={isListening}
            isProcessing={isProcessing}
            engine={builtInEnabled ? 'builtin' : 'browser'}
            wakeWordMode={wakeWordMode}
            isWakeWordActive={isWakeWordActive}
            onToggleWakeWordMode={handleToggleWakeWordMode}
            battery={battery}
            voiceName={voicePreset.shortLabel}
            onOpenVoice={() => window.dispatchEvent(new Event('jarvis:open-voice'))}
            onOpenVoiceId={() => window.dispatchEvent(new Event('jarvis:open-voice-id'))}
          />
        );
      case 'conversation':
        return (
          <ConversationPanel
            state={audioState}
            isListening={isListening}
            isProcessing={isProcessing}
            transcript={transcript}
            interimTranscript={interimTranscript}
            lastQuery={lastQuery}
            lastResponse={lastResponse}
            lastSpeaker={lastSpeaker}
            speakerConfidence={speakerConfidence}
            isOwner={isOwner}
            history={history}
            followUpWindow={followUpWindow}
            onToggleListening={handleToggleListening}
            onSubmitText={(text: string) => handleCommandSubmit(text, 'typed')}
            onStopSpeaking={handleStopSpeaking}
            canStop={jarvisActive}
            onReplayResponse={handleReplay}
            onClearHistory={() => setHistory([])}
          />
        );
    }
  };

  const topBar = (
    <TelemetryHUD
      state={audioState}
      isListening={isListening}
      isWakeWordActive={isWakeWordActive}
      wakeWordMode={wakeWordMode}
      wakeWordScope={wakeWordScope}
      battery={battery}
      voiceName={voicePreset.shortLabel}
      activeVoicePresetId={voicePreset.id}
      activeSpeakerName={lastSpeaker}
      onTestVoice={handleVoiceTest}
      onPreviewVoice={handleVoicePreview}
      onLockConsole={handleLockConsole}
      onToggleWakeWordMode={handleToggleWakeWordMode}
      onToggleWakeWordScope={handleToggleWakeWordScope}
      onSelectVoicePreset={handleSelectVoicePreset}
    />
  );

  // Wide screens (TV, desktop): reactor in the middle, widgets placed freely around it
  if (isWide) {
    return (
      <main className="relative w-full h-[100dvh] overflow-hidden bg-[#02040a] hud-grid">
        {/* Cinematic CRT Scanlines and Radial Vignette */}
        <div className="absolute inset-0 hud-scanline z-10 pointer-events-none" />
        <div className="absolute inset-0 hud-vignette z-10 pointer-events-none" />

        {topBar}

        {/* Jarvis's screen (SHOW_IMAGE / SHOW_IMAGE_SEARCH / SHOW_VIDEO / SHOW_CAMERA) */}
        <ScreenPanel />

        {/* Arc reactor, centred between the default widget columns; with the screen up it
            shrinks into the space below it. */}
        <section
          className={`absolute z-10 flex items-center justify-center transition-all duration-700 ${
            screenActive ? 'left-[372px] right-[482px] bottom-0 h-[230px]' : 'left-[360px] right-[470px] top-[56px] bottom-0'
          }`}
        >
          <ArcReactorVisualizer state={audioState} onReactorClick={handleToggleListening} />
          {!screenActive && (
            <StateCaption
              state={audioState}
              isListening={isListening}
              isProcessing={isProcessing}
              wakeActive={isWakeWordActive}
              onStop={jarvisActive && !editingLayout ? handleStopSpeaking : undefined}
            />
          )}
        </section>

        <WidgetBoard wide editing={editingLayout} onDoneEditing={stopEditingLayout} render={renderWidget} />

        {/* Timers: centre column, above the status caption */}
        <TimerStack className="absolute z-40 left-[360px] right-[470px] bottom-[15%]" />
        {toast && <NotificationToast note={toast} onClose={closeToast} />}
      </main>
    );
  }

  // Phones / tablets: the voice screen first, widgets below it (scroll down)
  return (
    <main className="relative w-full h-[100dvh] overflow-y-auto overflow-x-hidden overscroll-contain bg-[#02040a] hud-grid">
      <div className="fixed inset-0 hud-scanline z-10 pointer-events-none" />
      <div className="fixed inset-0 hud-vignette z-10 pointer-events-none" />

      {/* First screen; a sliver of the widgets peeks out below it */}
      <div className="relative w-full h-[calc(100dvh-40px)] min-h-[340px]">
        {topBar}

        {/* Floating music controls */}
        <YouTubeMediaHUD />

        {/* Timers, just under the top bar */}
        <TimerStack className="absolute z-40 inset-x-3 top-14" />

        {/* Jarvis's screen (SHOW_IMAGE / SHOW_IMAGE_SEARCH / SHOW_VIDEO / SHOW_CAMERA) */}
        <ScreenPanel />

        {/* Kept above the subtitles card so the reactor stays visible */}
        <section className="absolute inset-x-0 top-12 bottom-[200px] short:top-10 short:bottom-[96px] z-10 flex items-center justify-center">
          <ArcReactorVisualizer state={audioState} onReactorClick={handleToggleListening} />
        </section>

        {/* Follow-up countdown + subtitles along the bottom */}
        {followUpWindow && isListening && !transcript && !interimTranscript && (
          <FollowUpCountdown endsAt={followUpWindow.endsAt} totalMs={followUpWindow.totalMs} />
        )}
        <SubtitlesOverlay
          state={audioState}
          isListening={isListening}
          transcript={transcript}
          interimTranscript={interimTranscript}
          lastQuery={lastQuery}
          lastResponse={lastResponse}
          lastSpeaker={lastSpeaker}
          speakerConfidence={speakerConfidence}
          isOwner={isOwner}
          isProcessing={isProcessing}
          history={history}
          onToggleListening={handleToggleListening}
          onSubmitText={(text: string) => handleCommandSubmit(text, 'typed')}
          onStopSpeaking={handleStopSpeaking}
            canStop={jarvisActive}
          onReplayResponse={handleReplay}
          onClearHistory={() => setHistory([])}
        />
      </div>

      <WidgetBoard wide={false} editing={editingLayout} onDoneEditing={stopEditingLayout} render={renderWidget} />
      {toast && <NotificationToast note={toast} onClose={closeToast} />}
    </main>
  );
};

export default App;
