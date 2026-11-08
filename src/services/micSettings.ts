// Microphone echo cancellation setting.
//
// On Android, asking for echo cancellation switches the phone into "call mode" (as for a video
// call), and call audio always plays from the phone's own speaker. With Samsung DeX on a TV,
// Jarvis's voice then comes out of the phone instead of the TV. With echo cancellation off,
// audio follows the normal output (HDMI) again. Jarvis's own speech is still kept out of the
// mic by the software echo filter, the stricter wake threshold while he talks and voice ID's
// exclusion of his speaking time.
export type EchoCancelMode = 'auto' | 'on' | 'off';

const KEY = 'jarvis_mic_echo_cancel';
const RELEASE_KEY = 'jarvis_release_mic_while_speaking';
const EVENT = 'jarvis:mic-settings';

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export function getEchoCancelMode(): EchoCancelMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Whether the mic should ask for echo cancellation (auto: off on Android, on elsewhere) */
export function wantsEchoCancellation(): boolean {
  const mode = getEchoCancelMode();
  return mode === 'auto' ? !isAndroid() : mode === 'on';
}

export function micConstraints(): MediaTrackConstraints {
  const aec = wantsEchoCancellation();
  // On Android the phone's built-in noise suppression / auto gain can also switch on call mode,
  // so without echo cancellation the mic is opened raw there
  const processing = aec || !isAndroid();
  return { channelCount: 1, echoCancellation: aec, noiseSuppression: processing, autoGainControl: processing };
}

export function setEchoCancelMode(mode: EchoCancelMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function onMicSettingsChange(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * Close the mic while Jarvis answers. Some Android phones (e.g. the S9 on DeX) go into call mode
 * whenever any mic is open, raw or not, and play everything through the phone's own speaker.
 * With the mic closed, Jarvis plays through the normal output (the TV). Cost: no voice
 * interruptions mid-reply (tapping still works). Default: on for Android.
 */
export function getReleaseMicWhileSpeaking(): boolean {
  try {
    const v = localStorage.getItem(RELEASE_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {}
  return isAndroid();
}

export function setReleaseMicWhileSpeaking(on: boolean) {
  try {
    localStorage.setItem(RELEASE_KEY, on ? 'on' : 'off');
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const LIVE_STT_KEY = 'jarvis_live_transcription';

/** Live (streaming) transcription for the built-in listener. On unless turned off. */
export function getLiveTranscription(): boolean {
  try {
    return localStorage.getItem(LIVE_STT_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLiveTranscription(on: boolean) {
  try {
    localStorage.setItem(LIVE_STT_KEY, on ? 'on' : 'off');
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}
