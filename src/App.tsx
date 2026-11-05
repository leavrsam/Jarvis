import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArcReactorVisualizer } from './components/ArcReactorVisualizer';
import { TelemetryHUD } from './components/TelemetryHUD';
import { SubtitlesOverlay } from './components/SubtitlesOverlay';
import { SecurityGate } from './components/SecurityGate';
import { audioEngine, JarvisAudioState } from './services/audioEngine';
import { sendJarvisCommand } from './services/jarvisBackend';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';

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

  const [audioState, setAudioState] = useState<JarvisAudioState>('idle');
  const [lastResponse, setLastResponse] = useState<string>('All systems operational. Standing by for command.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<{ query: string; response: string; timestamp: Date }[]>([]);
  const isSpeakingRef = useRef(false);

  // Sync speaking state
  useEffect(() => {
    isSpeakingRef.current = audioState === 'speaking';
  }, [audioState]);

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

  // Web Speech Recognition Hook
  const {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    onFinalSubmit: handleCommandSubmit,
    silenceTimeoutMs: 1800,
    isJarvisSpeaking: audioState === 'speaking' || isProcessing || !isAuthenticated,
  });

  // Wrap toggle to also initialize Web Audio Context & Mic
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
        voiceName={audioEngine.getVoiceName()}
        historyLength={history.length}
        onClearHistory={() => setHistory([])}
        onTestVoice={handleVoiceTest}
        onLockConsole={handleLockConsole}
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
