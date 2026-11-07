import { useState, useEffect, useRef, useCallback } from 'react';
import { voiceBiometrics } from '../services/voiceBiometrics';

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
  /**
   * What Jarvis is saying now or said in the last few seconds. Any recognized speech that
   * matches it is his own voice coming back through the mic and is ignored in every mode.
   */
  getEchoReference?: () => string;
  silenceTimeoutMs?: number;
  followUpTimeoutMs?: number;
  isJarvisSpeaking?: boolean;
  currentJarvisSpeech?: string;
  wakeWordEnabled?: boolean;
}

// Phonetically tolerant regex: captures "Hey Jarvis", "Jarvis", and common Web Speech mistranscriptions ("Travis", "Harvest", "Jarves")
const WAKE_WORD_REGEX = /\b(?:hey\s+|ok\s+|hi\s+|yo\s+)?(?:jarvis|travis|harvest|jarves|jarv|charvis)\b/i;

// Explicit audible interruption intents
const AUDIBLE_INTERRUPT_REGEX = /\b(?:hey\s+|ok\s+|hi\s+|yo\s+)?(?:jarvis|wait|stop|hold on|shut up|quiet|cancel|listen|actually|never mind|nevermind|hang on|pause)\b/i;

/**
 * Checks whether speech captured by the microphone while Jarvis is talking is an acoustic echo
 * of Jarvis's own dialogue from the speakers.
 */
function isSelfEcho(utterance: string, jarvisSpeech: string): boolean {
  if (!jarvisSpeech || !jarvisSpeech.trim()) return false;

  const cleanUtterance = utterance.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const cleanJarvis = jarvisSpeech.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

  if (!cleanUtterance) return true;

  // 1. Direct substring containment (e.g. mic caught words of Jarvis's sentence)
  if (cleanJarvis.includes(cleanUtterance)) {
    return true;
  }

  // 2. High lexical overlap check (accounts for minor speech-to-text drops)
  const uttWords = cleanUtterance.split(/\s+/).filter(w => w.length > 2);
  if (uttWords.length === 0) return true;

  const jarvisWords = new Set(cleanJarvis.split(/\s+/));
  let matchedCount = 0;
  for (const w of uttWords) {
    if (jarvisWords.has(w)) matchedCount++;
  }

  // If >= 65% of the words are present in Jarvis's active speech, it is self-echo!
  return (matchedCount / uttWords.length) >= 0.65;
}

export function useSpeechRecognition({
  onFinalSubmit,
  onWakeWordDetected,
  onFollowUpTimeout,
  onBargeIn,
  silenceTimeoutMs = 750,
  followUpTimeoutMs = 15000,
  isJarvisSpeaking = false,
  currentJarvisSpeech = '',
  wakeWordEnabled = true,
  getEchoReference,
}: UseSpeechRecognitionOptions = {}) {
  const getEchoReferenceRef = useRef(getEchoReference);
  getEchoReferenceRef.current = getEchoReference;
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
  const currentJarvisSpeechRef = useRef(currentJarvisSpeech);
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

  // Sync speaking state & current spoken speech, keeping recognition running for audible barge-in
  useEffect(() => {
    isJarvisSpeakingRef.current = isJarvisSpeaking;
    currentJarvisSpeechRef.current = currentJarvisSpeech;
    isStandbyRef.current = wakeWordEnabled;
    setIsStandby(wakeWordEnabled);

    // Keep recognition active for wake-word or audible interruption
    if (wakeWordEnabled || isListeningRef.current || isJarvisSpeaking) {
      restartRecognition();
    }
  }, [isJarvisSpeaking, currentJarvisSpeech, wakeWordEnabled, restartRecognition]);

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

        // 0. Self-echo filter, in every mode: Jarvis's own words (including "One moment, sir"
        // while n8n works, and the tail of a reply that arrives after he stops talking) must
        // never become a command or a barge-in.
        const echoReference = [
          getEchoReferenceRef.current?.() || '',
          isJarvisSpeakingRef.current ? currentJarvisSpeechRef.current : '',
        ]
          .join(' ')
          .trim();
        if (echoReference && isSelfEcho(fullUtterance, echoReference)) {
          return;
        }

        // 1. Hands-Free Voice Interruption / Barge-In while Jarvis is speaking!
        if (isJarvisSpeakingRef.current) {
          // Acoustic Self-Echo Filter: If microphone captures Jarvis's own vocal text, DISCARD!
          if (isSelfEcho(fullUtterance, currentJarvisSpeechRef.current)) {
            return;
          }

          // Not Jarvis's text! Check if user spoke an interruption intent or new command
          const isInterruptIntent = AUDIBLE_INTERRUPT_REGEX.test(fullUtterance);
          const wordCount = fullUtterance.split(/\s+/).length;

          // Biometric Speaker Authentication: verify live voice matches enrolled Owner
          const speakerAuth = voiceBiometrics.isAuthorizedSpeaker();

          if ((isInterruptIntent || wordCount >= 2) && speakerAuth.isAuthorized) {
            isJarvisSpeakingRef.current = false;
            setIsListening(true);
            isListeningRef.current = true;

            // Extract trailing speech if user said e.g. "Jarvis what is the weather" or "Wait play music"
            let trailing = fullUtterance;
            const match = fullUtterance.match(AUDIBLE_INTERRUPT_REGEX);
            if (match && match.index !== undefined) {
              trailing = fullUtterance.slice(match.index + match[0].length).replace(/^[,.\s]+/, '').trim();
            }

            if (trailing && trailing.length > 1) {
              activeTranscriptRef.current = trailing;
              setTranscript(trailing);
              resetSilenceTimer();
            } else {
              activeTranscriptRef.current = '';
              setTranscript('');
              armFollowUpTimer();
            }

            onBargeInRef.current?.(trailing);
            return;
          }

          // Otherwise ignore non-authorized noise
          return;
        }

        // 2. Check for Wake Word ("Hey Jarvis" / "Jarvis") if in standby
        if (!isListeningRef.current && isStandbyRef.current && !wakeWordHandledRef.current) {
          const match = fullUtterance.match(WAKE_WORD_REGEX);
          if (match && match.index !== undefined) {
            const trailing = fullUtterance.slice(match.index + match[0].length).replace(/^[,.\s]+/, '').trim();
            handleWakeWordDetection(trailing);
            return;
          }
        }

        // 3. Active Command Capture Mode
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
        // Keep listening loop alive in background for wake-word or audible barge-in
        if (isListeningRef.current || isStandbyRef.current || isJarvisSpeakingRef.current) {
          restartRecognition();
        }
      };

      recognitionRef.current = recognition;

      if (isStandbyRef.current || isJarvisSpeakingRef.current) {
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

    if (isStandbyRef.current) {
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
