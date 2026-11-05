import { useState, useEffect, useRef, useCallback } from 'react';

// Web Speech API interfaces
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface IWindowSpeech extends Window {
  SpeechRecognition?: {
    new (): SpeechRecognitionInstance;
  };
  webkitSpeechRecognition?: {
    new (): SpeechRecognitionInstance;
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface UseSpeechRecognitionOptions {
  onFinalSubmit?: (text: string) => void;
  silenceTimeoutMs?: number;
  isJarvisSpeaking?: boolean;
}

export function useSpeechRecognition({
  onFinalSubmit,
  silenceTimeoutMs = 1800,
  isJarvisSpeaking = false,
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTranscriptRef = useRef<string>('');
  const isListeningRef = useRef(false);
  const isJarvisSpeakingRef = useRef(isJarvisSpeaking);

  // Sync ref
  useEffect(() => {
    isJarvisSpeakingRef.current = isJarvisSpeaking;
    // If Jarvis starts speaking, temporarily pause/mute recognition or ignore results
  }, [isJarvisSpeaking]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const triggerSubmission = useCallback(() => {
    clearSilenceTimer();
    const query = activeTranscriptRef.current.trim();
    if (query && query.length > 1) {
      setTranscript(query);
      setInterimTranscript('');
      activeTranscriptRef.current = '';
      onFinalSubmit?.(query);
    }
  }, [onFinalSubmit]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      // Trigger auto-submit after user pauses speaking
      if (activeTranscriptRef.current.trim().length > 1) {
        triggerSubmission();
      }
    }, silenceTimeoutMs);
  }, [silenceTimeoutMs, triggerSubmission]);

  useEffect(() => {
    const win = window as unknown as IWindowSpeech;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      setError('Web Speech Recognition API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // If Jarvis is currently speaking through TTS, ignore recognition to prevent echoing
        if (isJarvisSpeakingRef.current) {
          return;
        }

        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            finalChunk += text;
          } else {
            interim += text;
          }
        }

        if (finalChunk) {
          activeTranscriptRef.current = (activeTranscriptRef.current + ' ' + finalChunk).trim();
          setTranscript(activeTranscriptRef.current);
          setInterimTranscript('');
          resetSilenceTimer();
        } else if (interim) {
          setInterimTranscript(interim);
          resetSilenceTimer();
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech') {
          // Expected when quiet, ignore
          return;
        }
        if (event.error === 'aborted') {
          return;
        }
        console.warn('[SpeechRecognition] Error:', event.error, event.message);
        setError(`Mic: ${event.error}`);
      };

      recognition.onend = () => {
        // If user wants continuous listening and not stopped manually
        if (isListeningRef.current && !isJarvisSpeakingRef.current) {
          try {
            recognition.start();
          } catch {
            setIsListening(false);
            isListeningRef.current = false;
          }
        } else {
          setIsListening(false);
          isListeningRef.current = false;
        }
      };

      recognitionRef.current = recognition;
    } catch (e: unknown) {
      console.error('[SpeechRecognition Init]', e);
      setIsSupported(false);
    }

    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, [resetSilenceTimer]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    try {
      activeTranscriptRef.current = '';
      setTranscript('');
      setInterimTranscript('');
      isListeningRef.current = true;
      recognitionRef.current.start();
    } catch {
      // might already be started
      setIsListening(true);
    }
  }, []);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    clearSilenceTimer();
    if (activeTranscriptRef.current.trim().length > 1) {
      triggerSubmission();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
  }, [triggerSubmission]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Spacebar push-to-talk handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        toggleListening();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleListening]);

  return {
    isListening,
    transcript,
    interimTranscript,
    isSupported,
    error,
    startListening,
    stopListening,
    toggleListening,
    triggerSubmission,
    setTranscript,
    setInterimTranscript,
  };
}
