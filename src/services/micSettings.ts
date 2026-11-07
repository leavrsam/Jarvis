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
  return { channelCount: 1, echoCancellation: wantsEchoCancellation(), noiseSuppression: true, autoGainControl: true };
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
