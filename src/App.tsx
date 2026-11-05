import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArcReactorVisualizer } from './components/ArcReactorVisualizer';
import { TelemetryHUD, WakeWordMode } from './components/TelemetryHUD';
import { SubtitlesOverlay } from './components/SubtitlesOverlay';
import { SecurityGate } from './components/SecurityGate';
import { audioEngine, JarvisAudioState } from './services/audioEngine';
import { sendJarvisCommand } from './services/jarvisBackend';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useBatteryStatus } from './hooks/useBatteryStatus';

// Passcode configured via VITE_JARVIS_SECRET (Vercel env var) or default secret
const ACCESS_SECRET = (import.meta.env.VITE_JARVIS_SECRET as string | undefined)?.trim() || 'wolfcub';

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
  const [lastResponse, setLastResponse] = useState<string>('All systems operational. Standing by for command.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<{ query: string; response: string; timestamp: Date }[]>([]);
  const isSpeakingRef = useRef(false);

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

  // Execute Backend Dispatch to n8n Webhook
  const handleCommandSubmit = useCallback(async (query: string) => {
    if (!query || query.trim().length === 0) return;
    
    // Stop mic listening while processing and speaking
    audioEngine.stopMicListening();
    audioEngine.setState('processing');
    setAudioState('processing');
    setIsProcessing(true);
    audioEngine.playSfx('processing');

    try {
      // POST { query: transcript, sessionId: "jarvis-web" } to n8n webhook
      const reply = await sendJarvisCommand(query, 'jarvis-web');
      setLastResponse(reply);
      setHistory(prev => [{ query, response: reply, timestamp: new Date() }, ...prev]);
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
          setAudioState('idle');
        }
      );
    } catch (err: unknown) {
      setIsProcessing(false);
      audioEngine.playSfx('error');
      const errText = 'Neural network dispatch error. Unable to establish link with n8n matrix.';
      setLastResponse(errText);
      setAudioState('speaking');
      await audioEngine.speak(errText, () => setAudioState('speaking'), () => setAudioState('idle'));
    }
  }, []);

  // Handler for Wake Word ("Hey Jarvis" / "Jarvis") trigger
  const handleWakeWordDetected = useCallback(async (trailingQuery?: string) => {
    if (!isAuthenticated) return;

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
    silenceTimeoutMs: 1800,
    isJarvisSpeaking: audioState === 'speaking' || isProcessing || !isAuthenticated,
    wakeWordEnabled: isWakeWordActive,
  });

  // Manual Push-to-Talk or Hotkey Toggle
  const handleToggleListening = useCallback(async () => {
    if (!isAuthenticated) return;
    audioEngine.ensureContext();
    if (audioState === 'speaking') {
      audioEngine.stopSpeaking();
    }

    if (isListening) {
      stopListening();
      audioEngine.stopMicListening();
      setAudioState('idle');
    } else {
      audioEngine.playSfx('activate');
      await audioEngine.startMicListening();
      startListening();
      setAudioState('listening');
    }
  }, [isAuthenticated, audioState, isListening, startListening, stopListening]);

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
    audioEngine.ensureContext();
    audioEngine.playSfx('activate');
    const greeting = 'J.A.R.V.I.S. online. Arc-reactor and neural harmonics calibrated. Standing by for instructions.';
    setLastResponse(greeting);
    setAudioState('speaking');
    audioEngine.speak(
      greeting,
      () => setAudioState('speaking'),
      () => setAudioState('idle')
    );
  }, []);

  const handleStopSpeaking = useCallback(() => {
    audioEngine.stopSpeaking();
    setAudioState('idle');
  }, []);

  // Lock Console action
  const handleLockConsole = useCallback(() => {
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
        voiceName={audioEngine.getVoiceName()}
        historyLength={history.length}
        onClearHistory={() => setHistory([])}
        onTestVoice={handleVoiceTest}
        onLockConsole={handleLockConsole}
        onToggleWakeWordMode={handleToggleWakeWordMode}
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
        lastResponse={lastResponse}
        isProcessing={isProcessing}
        onToggleListening={handleToggleListening}
        onSubmitText={handleCommandSubmit}
        onStopSpeaking={handleStopSpeaking}
      />
    </main>
  );
};

export default App;
