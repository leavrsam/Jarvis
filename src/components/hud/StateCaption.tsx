// One quiet line under the reactor saying what Jarvis is doing.
import React from 'react';
import type { JarvisAudioState } from '../../services/audioEngine';

export const StateCaption: React.FC<{ state: JarvisAudioState; isListening: boolean; isProcessing: boolean; wakeActive: boolean }> = ({
  state,
  isListening,
  isProcessing,
  wakeActive,
}) => {
  const [title, hint, color] = isProcessing
    ? ['THINKING', '', 'text-amber-200']
    : isListening
      ? ['LISTENING', '', 'text-cyan-200']
      : state === 'speaking'
        ? ['SPEAKING', '', 'text-emerald-200']
        : ['STANDING BY', wakeActive ? 'Say “Hey Jarvis”' : 'Press Space to talk', 'text-amber-400/80'];
  return (
    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[7%] text-center select-none">
      <div className={`font-orbitron text-[13px] tracking-[0.5em] pl-[0.5em] ${color} transition-colors duration-500`}>{title}</div>
      {hint && <div className="mt-1.5 text-[13px] text-amber-600/80 tracking-wide">{hint}</div>}
    </div>
  );
};
