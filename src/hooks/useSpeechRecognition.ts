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
  onFollowUpTimeout?: () => void;
  onBargeIn?: (trailingQuery?: string) => void;
  silenceTimeoutMs?: number;
  followUpTimeoutMs?: number;
  isJarvisSpeaking?: boolean;
  wakeWordEnabled?: boolean;
}

// Phonetically tolerant regex: captures "Hey Jarvis", "Jarvis", and common Web Speech mistranscriptions ("Travis", "Harvest", "Jarves")
const WAKE_WORD_REGEX = /\b(?:hey\s+|ok\s+|hi\s+|yo\s+)?(?:jarvis|travis|harvest|jarves|jarv|charvis)\b/i;

export function useSpeechRecognition({
  onFinalSubmit,
  onWakeWordDetected,
  onFollowUpTimeout,
  onBargeIn,
  silenceTimeoutMs = 750,
  followUpTimeoutMs = 15000,
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
  const followUpTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTranscriptRef = useRef<string>('');
  const isListeningRef = useRef(false);
  const isStandbyRef = useRef(wakeWordEnabled);
  const isJarvisSpeakingRef = useRef(isJarvisSpeaking);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wakeWordHandledRef = useRef(false);

  // Store callbacks in refs so recognition instance never tears down on re-renders
  const onFinalSubmitRef = useRef(onFinalSubmit);
  const onWakeWordDetectedRef = useRef(onWakeWordDetected);
  const onFollowUpTimeoutRef = useRef(onFollowUpTimeout);
  const onBargeInRef = useRef(onBargeIn);
  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  const followUpTimeoutMsRef = useRef(followUpTimeoutMs);

  useEffect(() => {
    onFinalSubmitRef.current = onFinalSubmit;
    onWakeWordDetectedRef.current = onWakeWordDetected;
    onFollowUpTimeoutRef.current = onFollowUpTimeout;
    onBargeInRef.current = onBargeIn;
    silenceTimeoutMsRef.current = silenceTimeoutMs;
    followUpTimeoutMsRef.current = followUpTimeoutMs;
  }, [onFinalSubmit, onWakeWordDetected, onFollowUpTimeout, onBargeIn, silenceTimeoutMs, followUpTimeoutMs]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearFollowUpTimer = useCallback(() => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }
  }, []);

  // Safely start or restart recognition
  const restartRecognition = useCallback((immediate = false) => {
    if (!recognitionRef.current) return;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);

    const runStart = () => {
      // Never start speech recognition while Jarvis is actively speaking out loud
      if (isJarvisSpeakingRef.current) return;
      try {
        recognitionRef.current?.start();
      } catch {
        // Recognition already active or starting
      }
    };

    if (immediate) {
      runStart();
    } else {
      restartTimeoutRef.current = setTimeout(runStart, 80);
    }
  }, []);

  // Sync speaking state & manage recognition lifecycle to prevent self-interruption
  useEffect(() => {
    const wasSpeaking = isJarvisSpeakingRef.current;
    isJarvisSpeakingRef.current = isJarvisSpeaking;
    isStandbyRef.current = wakeWordEnabled;
    setIsStandby(wakeWordEnabled);

    if (isJarvisSpeaking) {
      // When Jarvis begins speaking: abort speech recognition so it stops listening to speakers!
      try {
        recognitionRef.current?.abort();
      } catch {}
    } else if (wasSpeaking && !isJarvisSpeaking) {
      // The moment Jarvis finishes speaking: immediately restart recognition to listen for user reply!
      if (isListeningRef.current || isStandbyRef.current) {
        restartRecognition(true);
      }
    }
  }, [isJarvisSpeaking, wakeWordEnabled, restartRecognition]);

  const triggerSubmission = useCallback(() => {
    clearSilenceTimer();
    clearFollowUpTimer();
    const query = activeTranscriptRef.current.trim();
    if (query && query.length > 1) {
      setTranscript('');
      setInterimTranscript('');
      activeTranscriptRef.current = '';
      setIsListening(false);
      isListeningRef.current = false;
      onFinalSubmitRef.current?.(query);
    }
  }, [clearSilenceTimer, clearFollowUpTimer]);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    clearFollowUpTimer();
    const currentText = activeTranscriptRef.current.trim();
    // Fast response: if sentence has punctuation, trigger in 350ms; otherwise 750ms
    const hasPunctuation = /[.?!]$/.test(currentText);
    const delay = hasPunctuation ? 350 : Math.min(silenceTimeoutMsRef.current, 750);

    silenceTimerRef.current = setTimeout(() => {
      if (activeTranscriptRef.current.trim().length > 1) {
        triggerSubmission();
      }
    }, delay);
  }, [clearSilenceTimer, clearFollowUpTimer, triggerSubmission]);

  const armFollowUpTimer = useCallback(() => {
    clearFollowUpTimer();
    followUpTimerRef.current = setTimeout(() => {
      if (isListeningRef.current && activeTranscriptRef.current.trim().length === 0) {
        isListeningRef.current = false;
        setIsListening(false);
        setTranscript('');
        setInterimTranscript('');
        onFollowUpTimeoutRef.current?.();
      }
    }, followUpTimeoutMsRef.current);
  }, [clearFollowUpTimer]);

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
      armFollowUpTimer();
    }

    onWakeWordDetectedRef.current?.(trailingQuery);

    // Reset wake flag after debounce
    setTimeout(() => {
      wakeWordHandledRef.current = false;
    }, 1200);
  }, [resetSilenceTimer, armFollowUpTimer]);

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
        // Absolute Echo Immunity: Never process microphone input while Jarvis is outputting dialogue
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
        if (!fullUtterance) return;

        // 1. Check for Wake Word ("Hey Jarvis" / "Jarvis") if in standby
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
            if (cleanedInterim) {
              clearFollowUpTimer(); // User started speaking
              setInterimTranscript(cleanedInterim);
              if (activeTranscriptRef.current.trim().length > 0) {
                resetSilenceTimer();
              }
            }
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
        // Keep listening loop alive in background if wake-word is enabled or listening, BUT NEVER while Jarvis is speaking
        if (!isJarvisSpeakingRef.current && (isListeningRef.current || isStandbyRef.current)) {
          restartRecognition();
        }
      };

      recognitionRef.current = recognition;

      // Start recognition if wake-word is enabled and not speaking
      if (isStandbyRef.current && !isJarvisSpeakingRef.current) {
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
      clearFollowUpTimer();
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
  }, [clearSilenceTimer, clearFollowUpTimer, handleWakeWordDetection, resetSilenceTimer, restartRecognition]);

  const startListening = useCallback((isFollowUp = false) => {
    isJarvisSpeakingRef.current = false;
    activeTranscriptRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    setIsListening(true);
    isListeningRef.current = true;
    clearSilenceTimer();
    if (isFollowUp) {
      armFollowUpTimer();
    } else {
      clearFollowUpTimer();
    }
    restartRecognition(true);
  }, [clearSilenceTimer, clearFollowUpTimer, armFollowUpTimer, restartRecognition]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    clearSilenceTimer();
    clearFollowUpTimer();

    if (activeTranscriptRef.current.trim().length > 1) {
      triggerSubmission();
    } else {
      setTranscript('');
      setInterimTranscript('');
      activeTranscriptRef.current = '';
    }

    if (isStandbyRef.current && !isJarvisSpeakingRef.current) {
      restartRecognition();
    } else if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  }, [clearSilenceTimer, clearFollowUpTimer, restartRecognition, triggerSubmission]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening(false);
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
