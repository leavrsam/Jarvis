// One quiet line under the reactor saying what Jarvis is doing.
import React from 'react';
import { Square } from 'lucide-react';
import type { JarvisAudioState } from '../../services/audioEngine';

export const StateCaption: React.FC<{
  state: JarvisAudioState;
  isListening: boolean;
  isProcessing: boolean;
  wakeActive: boolean;
  /** Shown while Jarvis is doing anything: stops it all */
  onStop?: () => void;
}> = ({ state, isListening, isProcessing, wakeActive, onStop }) => {
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
      {onStop && (
        <button
          onClick={onStop}
          title="Stop (Esc)"
          className="pointer-events-auto mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-red-500/60 bg-red-950/40 text-red-200 text-[12px] font-orbitron tracking-[0.2em] hover:bg-red-900/50 hover:border-red-400 transition-colors"
        >
          <Square className="w-3 h-3 fill-current" /> STOP
        </button>
      )}
    </div>
  );
};
