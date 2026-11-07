import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArcReactorVisualizer } from './components/ArcReactorVisualizer';
import { TelemetryHUD, WakeWordMode, WakeWordScope } from './components/TelemetryHUD';
import { SubtitlesOverlay, DialogueEntry } from './components/SubtitlesOverlay';
import { checkSession, logout, onAuthRequired } from './services/auth';
import { SecurityGate } from './components/SecurityGate';
import { YouTubeMediaHUD } from './components/YouTubeMediaHUD';
import { audioEngine, JarvisAudioState, JarvisNeuralVoicePreset } from './services/audioEngine';
import { streamJarvisCommand, JarvisBackendError } from './services/jarvisBackend';
import { ReplyStreamProcessor } from './services/replyStream';
import { voiceBiometrics } from './services/voiceBiometrics';
import { handleJarvisResponse, duckVolume, restoreVolume } from './services/youtubeController';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useBatteryStatus } from './hooks/useBatteryStatus';


// Sign-off phrases that gracefully end a multi-turn conversation after Jarvis replies
// How long to wait for the n8n agent before playing a spoken "One moment, sir." n8n usually
// answers in under a second now, so this only covers genuinely slow requests (tool calls).
const ACK_DELAY_MS = 1500;

// Spoken when the n8n run fails. "partial" = the connection dropped after part of the reply.
function failureMessage(partial: boolean, kind?: string): string {
  if (partial) return 'My apologies, sir. I lost the link to the n8n matrix mid-reply.';
  if (kind === 'rate_limited') return "One moment, sir. You're asking faster than I can keep up.";
  if (kind === 'run_failed') return 'My apologies, sir. That request failed partway through.';
  // Proxy couldn't reach n8n (wrong key, n8n down, timeout) or the connection failed
  return "I can't reach my systems, sir. Please try again in a moment.";
}

const CONVERSATION_END_REGEX = /\b(?:that's all|thats all|thank you jarvis|thanks jarvis|goodbye|bye jarvis|stop listening|go to sleep|stand by|standby)\b/i;

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
  // Tracks whether we are in an active multi-turn dialogue loop
  const inConversationRef = useRef(false);
  const startListeningRef = useRef<(isFollowUp?: boolean) => void>(() => {});
  // In-flight n8n request, so a new command can cancel it
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

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

  // Sync speaking state & handle intelligent YouTube audio ducking
  useEffect(() => {
    isSpeakingRef.current = audioState === 'speaking';
    if (audioState === 'speaking' || audioState === 'listening' || isProcessing) {
      duckVolume(20);
    } else if (audioState === 'idle') {
      restoreVolume();
    }
  }, [audioState, isProcessing]);

  // Pre-synthesize the instant "One moment, sir." phrases once unlocked
  useEffect(() => {
    if (isAuthenticated) {
      void audioEngine.preloadAcknowledgements();
    }
  }, [isAuthenticated]);

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
    startListeningRef.current(true);
  }, []);

  // Execute Backend Dispatch to n8n Webhook with Biometric Speaker Metadata
  const handleCommandSubmit = useCallback(async (query: string, source: 'voice' | 'typed' = 'voice') => {
    if (!query || query.trim().length === 0) return;

    const trimmedQuery = query.trim();
    // Record user prompt for HUD attribution
    setLastQuery(trimmedQuery);

    // Voice ID: the utterance audio is grabbed right now (synchronously, from the rolling mic
    // buffer); the voiceprint is computed while the UI switches to "processing" below.
    const speakerPromise = voiceBiometrics.identifySpeaker(trimmedQuery, source);

    // Check if the user is signing off ("That's all, thanks Jarvis")
    if (CONVERSATION_END_REGEX.test(trimmedQuery)) {
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

    const speakerResult = await speakerPromise;
    if (!isCurrent()) return;
    setLastSpeaker(speakerResult.name);
    setSpeakerConfidence(speakerResult.confidence);
    setIsOwner(speakerResult.isOwner);
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
      audioEngine.setState('speaking');
      setAudioState('speaking');
      await audioEngine.speak(refusal, undefined, () => {
        if (isCurrent()) void resumeFollowUpListening();
      });
      return;
    }

    // If the n8n agent hasn't answered quickly, cover the wait with an instant spoken acknowledgement
    const ackTimer = setTimeout(() => {
      audioEngine.playAcknowledgement(speakerResult.isOwner);
    }, ACK_DELAY_MS);

    // Sentences are spoken as soon as each one is complete, back-to-back
    const speech = audioEngine.createSpeechQueue(
      () => {
        if (!isCurrent()) return;
        console.info(`[Jarvis] first audio after ${Math.round(performance.now() - t0)}ms`);
        audioEngine.setState('speaking');
        setAudioState('speaking');
      },
      () => {
        // Automatically re-open mic for seamless multi-turn back-and-forth dialogue
        if (isCurrent()) void resumeFollowUpListening();
      }
    );

    let gotText = false;
    const reply = new ReplyStreamProcessor({
      // Playback directives (PLAY_YOUTUBE: <id>, SET_VOLUME: 40, ...) are executed, never spoken
      onDirective: (directive) => {
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
            clearTimeout(ackTimer);
            reply.push(delta);
          },
        }
      );
    } catch (err) {
      if (controller.signal.aborted || !isCurrent()) {
        clearTimeout(ackTimer);
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
    clearTimeout(ackTimer);
    if (!isCurrent()) return;

    // Flush whatever is left of the reply (the last sentence may have no trailing space)
    reply.end();
    const finalText = reply.displayText;

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

    speech.finish();
    await speech.done;
  }, [resumeFollowUpListening, interruptCurrentReply]);

  // Handler for Wake Word ("Hey Jarvis" / "Jarvis") trigger
  const handleWakeWordDetected = useCallback(async (trailingQuery?: string) => {
    if (!isAuthenticated) return;

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
    inConversationRef.current = false;
    audioEngine.stopMicListening();
    setAudioState('idle');
  }, []);

  // Web Speech Recognition Hook with wake-word detection, hands-free barge-in & global hotkeys
  const {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    onFinalSubmit: (query: string) => handleCommandSubmit(query, 'voice'),
    onWakeWordDetected: handleWakeWordDetected,
    onFollowUpTimeout: handleFollowUpTimeout,
    onBargeIn: handleBargeIn,
    silenceTimeoutMs: 750,
    followUpTimeoutMs: 15000,
    // 'processing' also covers the gap between the first streamed text and the first audio
    isJarvisSpeaking: audioState === 'speaking' || audioState === 'processing' || isProcessing || !isAuthenticated,
    currentJarvisSpeech: audioState === 'speaking' ? lastResponse : '',
    wakeWordEnabled: isWakeWordActive,
    getEchoReference: () => audioEngine.getEchoReference(),
  });

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Manual Push-to-Talk or Hotkey Toggle
  const handleToggleListening = useCallback(async () => {
    if (!isAuthenticated) return;
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

  const handleStopSpeaking = useCallback(() => {
    inConversationRef.current = false;
    interruptCurrentReply();
    setAudioState('idle');
  }, [interruptCurrentReply]);

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

  if (!authChecked) {
    return <main className="w-full h-[100dvh] bg-[#02040a] hud-grid" aria-busy="true" />;
  }

  // Render the login screen if there's no valid session
  if (!isAuthenticated) {
    return <SecurityGate onUnlock={() => setIsAuthenticated(true)} serverConfigured={authConfigured} />;
  }

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-[#02040a] hud-grid">
      {/* Cinematic CRT Scanlines and Radial Vignette */}
      <div className="absolute inset-0 hud-scanline z-10 pointer-events-none" />
      <div className="absolute inset-0 hud-vignette z-10 pointer-events-none" />

      {/* Top and Side Telemetry HUD */}
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
        historyLength={history.length}
        onClearHistory={() => setHistory([])}
        onTestVoice={handleVoiceTest}
        onPreviewVoice={handleVoicePreview}
        onLockConsole={handleLockConsole}
        onToggleWakeWordMode={handleToggleWakeWordMode}
        onToggleWakeWordScope={handleToggleWakeWordScope}
        onSelectVoicePreset={handleSelectVoicePreset}
      />

      {/* Futuristic Sci-Fi YouTube Audio Controller Widget */}
      <YouTubeMediaHUD />

      {/* Center Holographic Arc-Reactor Three.js Visualizer */}
      <section className="relative w-full h-full flex items-center justify-center z-10">
        <ArcReactorVisualizer
          state={audioState}
          onReactorClick={handleToggleListening}
        />
      </section>

      {/* Bottom Subtitles & Voice Controls Overlay */}
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
        onReplayResponse={(text) => {
          inConversationRef.current = false;
          audioEngine.speak(
            text,
            () => setAudioState('speaking'),
            () => setAudioState('idle')
          );
        }}
        onClearHistory={() => setHistory([])}
      />
    </main>
  );
};

export default App;
