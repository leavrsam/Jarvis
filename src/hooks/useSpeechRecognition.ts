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

export interface UseSpeechRecognitionOptions {
  onFinalSubmit?: (text: string) => void;
  onWakeWordDetected?: (trailingQuery?: string) => void;
  silenceTimeoutMs?: number;
  isJarvisSpeaking?: boolean;
  wakeWordEnabled?: boolean;
}

const WAKE_WORD_REGEX = /\b(?:hey\s+|ok\s+|hi\s+|yo\s+)?jarvis\b/i;

export function useSpeechRecognition({
  onFinalSubmit,
  onWakeWordDetected,
  silenceTimeoutMs = 1800,
  isJarvisSpeaking = false,
  wakeWordEnabled = true,
}: UseSpeechRecognitionOptions = {}) {
  // Mode: 'standby' (waiting for "Hey Jarvis"), 'active' (recording command), 'idle'
  const [isListening, setIsListening] = useState(false);
  const [isStandby, setIsStandby] = useState(wakeWordEnabled);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTranscriptRef = useRef<string>('');
  const isListeningRef = useRef(false);
  const isStandbyRef = useRef(wakeWordEnabled);
  const isJarvisSpeakingRef = useRef(isJarvisSpeaking);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wakeWordHandledRef = useRef(false);

  // Sync refs
  useEffect(() => {
    isJarvisSpeakingRef.current = isJarvisSpeaking;
    isStandbyRef.current = wakeWordEnabled;
    setIsStandby(wakeWordEnabled);
  }, [isJarvisSpeaking, wakeWordEnabled]);

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
      setIsListening(false);
      isListeningRef.current = false;
      onFinalSubmit?.(query);
    }
  }, [onFinalSubmit]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (activeTranscriptRef.current.trim().length > 1) {
        triggerSubmission();
      }
    }, silenceTimeoutMs);
  }, [silenceTimeoutMs, triggerSubmission]);

  // Safely start or restart recognition
  const restartRecognition = useCallback(() => {
    if (!recognitionRef.current) return;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);

    restartTimeoutRef.current = setTimeout(() => {
      if (isJarvisSpeakingRef.current) return;
      try {
        recognitionRef.current?.start();
      } catch {
        // Recognition already active or starting
      }
    }, 150);
  }, []);

  const handleWakeWordDetection = useCallback((trailingQuery?: string) => {
    wakeWordHandledRef.current = true;
    setIsListening(true);
    isListeningRef.current = true;

    if (trailingQuery && trailingQuery.length > 1) {
      activeTranscriptRef.current = trailingQuery;
      setTranscript(trailingQuery);
      setInterimTranscript('');
      resetSilenceTimer();
    } else {
      activeTranscriptRef.current = '';
      setTranscript('');
      setInterimTranscript('');
    }

    onWakeWordDetected?.(trailingQuery);

    // Reset wake flag after debounce
    setTimeout(() => {
      wakeWordHandledRef.current = false;
    }, 1200);
  }, [onWakeWordDetected, resetSilenceTimer]);

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
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Ignore input if Jarvis is speaking to avoid feedback loop
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

        const fullUtterance = (finalChunk || interim).trim();

        // 1. Check for Wake Word ("Hey Jarvis" / "Jarvis") if in standby or wake word enabled
        if (!isListeningRef.current && isStandbyRef.current && !wakeWordHandledRef.current) {
          const match = fullUtterance.match(WAKE_WORD_REGEX);
          if (match && match.index !== undefined) {
            const trailing = fullUtterance.slice(match.index + match[0].length).replace(/^[,.\s]+/, '').trim();
            handleWakeWordDetection(trailing);
            return;
          }
        }

        // 2. Active Command Capture Mode
        if (isListeningRef.current) {
          if (finalChunk) {
            // Also sanitize in case wake word is present in the beginning of active capture
            let cleanedChunk = finalChunk;
            const match = cleanedChunk.match(WAKE_WORD_REGEX);
            if (match && match.index !== undefined && match.index === 0) {
              cleanedChunk = cleanedChunk.slice(match[0].length).replace(/^[,.\s]+/, '').trim();
            }

            if (cleanedChunk) {
              activeTranscriptRef.current = (activeTranscriptRef.current + ' ' + cleanedChunk).trim();
              setTranscript(activeTranscriptRef.current);
              setInterimTranscript('');
              resetSilenceTimer();
            }
          } else if (interim) {
            let cleanedInterim = interim;
            const match = cleanedInterim.match(WAKE_WORD_REGEX);
            if (match && match.index !== undefined && match.index === 0) {
              cleanedInterim = cleanedInterim.slice(match[0].length).replace(/^[,.\s]+/, '').trim();
            }
            setInterimTranscript(cleanedInterim);
            resetSilenceTimer();
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }
        console.warn('[SpeechRecognition] Error:', event.error, event.message);
        setError(`Mic: ${event.error}`);
      };

      recognition.onend = () => {
        // Keep listening loop alive in background if wake-word is enabled or currently listening
        if ((isListeningRef.current || isStandbyRef.current) && !isJarvisSpeakingRef.current) {
          restartRecognition();
        } else {
          setIsListening(false);
          isListeningRef.current = false;
        }
      };

      recognitionRef.current = recognition;

      // Start recognition if wakeWordEnabled is true
      if (wakeWordEnabled) {
        try {
          recognition.start();
        } catch {}
      }
    } catch (e: unknown) {
      console.error('[SpeechRecognition Init]', e);
      setIsSupported(false);
    }

    return () => {
      clearSilenceTimer();
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, [handleWakeWordDetection, resetSilenceTimer, restartRecognition, wakeWordEnabled]);

  const startListening = useCallback(() => {
    activeTranscriptRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    setIsListening(true);
    isListeningRef.current = true;
    restartRecognition();
  }, [restartRecognition]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    clearSilenceTimer();

    if (activeTranscriptRef.current.trim().length > 1) {
      triggerSubmission();
    } else {
      setTranscript('');
      setInterimTranscript('');
      activeTranscriptRef.current = '';
    }

    // If wake-word is still enabled, keep standby running
    if (isStandbyRef.current) {
      restartRecognition();
    } else if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  }, [restartRecognition, triggerSubmission]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isStandby,
    transcript,
    interimTranscript,
    isSupported,
    error,
    startListening,
    stopListening,
    toggleListening,
    triggerSubmission,
    restartRecognition,
    setTranscript,
    setInterimTranscript,
  };
}
