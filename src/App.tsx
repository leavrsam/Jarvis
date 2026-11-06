import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArcReactorVisualizer } from './components/ArcReactorVisualizer';
import { TelemetryHUD, WakeWordMode } from './components/TelemetryHUD';
import { SubtitlesOverlay } from './components/SubtitlesOverlay';
import { SecurityGate } from './components/SecurityGate';
import { audioEngine, JarvisAudioState, JarvisNeuralVoicePreset } from './services/audioEngine';
import { sendJarvisCommand } from './services/jarvisBackend';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useBatteryStatus } from './hooks/useBatteryStatus';

// Passcode configured via VITE_JARVIS_SECRET (Vercel env var) or default secret
const ACCESS_SECRET = (import.meta.env.VITE_JARVIS_SECRET as string | undefined)?.trim() || 'wolfcub';

// Sign-off phrases that gracefully end a multi-turn conversation after Jarvis replies
const CONVERSATION_END_REGEX = /\b(?:that's all|thats all|thank you jarvis|thanks jarvis|goodbye|bye jarvis|stop listening|go to sleep|stand by|standby)\b/i;

export const App: React.FC = () => {
  // Authentication state with localStorage caching
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('jarvis_auth_token');
      if (!cached) return false;
      return cached.trim().toLowerCase() === ACCESS_SECRET.toLowerCase();
    } catch {
      return false;
    }
  });

  // Battery status & Wake Word power profile
  const battery = useBatteryStatus();
  const [wakeWordMode, setWakeWordMode] = useState<WakeWordMode>(() => {
    try {
      const saved = localStorage.getItem('jarvis_wakeword_mode') as WakeWordMode | null;
      if (saved === 'charging_only' || saved === 'always' || saved === 'off') return saved;
      return 'charging_only'; // Default: listens when charging, conserves battery when unplugged
    } catch {
      return 'charging_only';
    }
  });

  const isWakeWordActive = isAuthenticated && (
    wakeWordMode === 'always' ||
    (wakeWordMode === 'charging_only' && battery.charging)
  );

  const [audioState, setAudioState] = useState<JarvisAudioState>('idle');
  const [voicePreset, setVoicePreset] = useState<JarvisNeuralVoicePreset>(() => audioEngine.getVoicePreset());
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('All systems operational. Standing by for command.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<{ query: string; response: string; timestamp: Date }[]>([]);
  const isSpeakingRef = useRef(false);
  // Tracks whether we are in an active multi-turn dialogue loop
  const inConversationRef = useRef(false);
  const startListeningRef = useRef<(isFollowUp?: boolean) => void>(() => {});

  // Sync speaking state
  useEffect(() => {
    isSpeakingRef.current = audioState === 'speaking';
  }, [audioState]);

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

  // Execute Backend Dispatch to n8n Webhook
  const handleCommandSubmit = useCallback(async (query: string) => {
    if (!query || query.trim().length === 0) return;

    const trimmedQuery = query.trim();
    // Record user prompt for HUD attribution
    setLastQuery(trimmedQuery);

    // Check if the user is signing off ("That's all, thanks Jarvis")
    if (CONVERSATION_END_REGEX.test(trimmedQuery)) {
      inConversationRef.current = false;
    } else {
      inConversationRef.current = true;
    }

    // Stop mic listening while processing and speaking
    audioEngine.stopMicListening();
    audioEngine.setState('processing');
    setAudioState('processing');
    setIsProcessing(true);
    audioEngine.playSfx('processing');

    try {
      // POST { query: transcript, sessionId: "jarvis-web" } to n8n webhook
      const reply = await sendJarvisCommand(trimmedQuery, 'jarvis-web');
      setLastResponse(reply);
      setHistory(prev => [{ query: trimmedQuery, response: reply, timestamp: new Date() }, ...prev]);
      setIsProcessing(false);
      audioEngine.playSfx('response');

      // Vocalize response using British TTS and route into visualizer analyser
      audioEngine.setState('speaking');
      setAudioState('speaking');

      await audioEngine.speak(
        reply,
        () => {
          setAudioState('speaking');
        },
        () => {
          // Automatically re-open mic for seamless multi-turn back-and-forth dialogue
          void resumeFollowUpListening();
        }
      );
    } catch {
      setIsProcessing(false);
      audioEngine.playSfx('error');
      const errText = 'Neural network dispatch error. Unable to establish link with n8n matrix.';
      setLastResponse(errText);
      setAudioState('speaking');
      await audioEngine.speak(
        errText,
        () => setAudioState('speaking'),
        () => {
          void resumeFollowUpListening();
        }
      );
    }
  }, [resumeFollowUpListening]);

  // Handler for Wake Word ("Hey Jarvis" / "Jarvis") trigger
  const handleWakeWordDetected = useCallback(async (trailingQuery?: string) => {
    if (!isAuthenticated) return;

    inConversationRef.current = true;
    audioEngine.ensureContext();
    audioEngine.playSfx('wake');

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
  }, [isAuthenticated]);

  const handleFollowUpTimeout = useCallback(() => {
    inConversationRef.current = false;
    audioEngine.stopMicListening();
    setAudioState('idle');
  }, []);

  // Web Speech Recognition Hook with wake-word detection & global hotkeys
  const {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    onFinalSubmit: handleCommandSubmit,
    onWakeWordDetected: handleWakeWordDetected,
    onFollowUpTimeout: handleFollowUpTimeout,
    silenceTimeoutMs: 1150,
    followUpTimeoutMs: 15000,
    isJarvisSpeaking: audioState === 'speaking' || isProcessing || !isAuthenticated,
    wakeWordEnabled: isWakeWordActive,
  });

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Manual Push-to-Talk or Hotkey Toggle
  const handleToggleListening = useCallback(async () => {
    if (!isAuthenticated) return;
    audioEngine.ensureContext();

    // If Jarvis is currently speaking, pressing Space / clicking the orb interrupts him and starts listening immediately!
    if (audioState === 'speaking') {
      inConversationRef.current = true;
      audioEngine.stopSpeaking();
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
  }, [isAuthenticated, audioState, isListening, startListening, stopListening]);

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
    audioEngine.stopSpeaking();
    setAudioState('idle');
  }, []);

  // Lock Console action
  const handleLockConsole = useCallback(() => {
    inConversationRef.current = false;
    try {
      localStorage.removeItem('jarvis_auth_token');
    } catch {}
    stopListening();
    audioEngine.stopMicListening();
    audioEngine.stopSpeaking();
    setAudioState('idle');
    setIsAuthenticated(false);
  }, [stopListening]);

  // Render Password Security Gate if not authenticated
  if (!isAuthenticated) {
    return (
      <SecurityGate
        onUnlock={() => setIsAuthenticated(true)}
        expectedSecret={ACCESS_SECRET}
      />
    );
  }

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#02040a] hud-grid">
      {/* Cinematic CRT Scanlines and Radial Vignette */}
      <div className="absolute inset-0 hud-scanline z-10 pointer-events-none" />
      <div className="absolute inset-0 hud-vignette z-10 pointer-events-none" />

      {/* Top and Side Telemetry HUD */}
      <TelemetryHUD
        state={audioState}
        isListening={isListening}
        isWakeWordActive={isWakeWordActive}
        wakeWordMode={wakeWordMode}
        battery={battery}
        voiceName={voicePreset.shortLabel}
        activeVoicePresetId={voicePreset.id}
        historyLength={history.length}
        onClearHistory={() => setHistory([])}
        onTestVoice={handleVoiceTest}
        onLockConsole={handleLockConsole}
        onToggleWakeWordMode={handleToggleWakeWordMode}
        onSelectVoicePreset={handleSelectVoicePreset}
      />

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
        isProcessing={isProcessing}
        history={history}
        onToggleListening={handleToggleListening}
        onSubmitText={handleCommandSubmit}
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
