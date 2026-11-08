// Conversation widget of the wide (kiosk / desktop) HUD.
// Live transcript while you talk, the current exchange (big and readable from across the room),
// earlier exchanges below, and talk / type controls at the bottom.
import React, { useEffect, useRef, useState } from 'react';
import { Fingerprint, Mic, RotateCcw, Send, Square, Trash2, Info } from 'lucide-react';
import type { JarvisAudioState } from '../../services/audioEngine';
import type { DialogueEntry } from '../SubtitlesOverlay';
import { cleanForDisplay } from '../../services/replyStream';

interface ConversationPanelProps {
  state: JarvisAudioState;
  isListening: boolean;
  isProcessing: boolean;
  transcript: string;
  interimTranscript: string;
  lastQuery: string;
  lastResponse: string;
  /** Shown instead of the reply when the last command wasn't answered (and why) */
  notice?: string | null;
  lastSpeaker?: string;
  speakerConfidence?: number;
  isOwner?: boolean;
  history: DialogueEntry[];
  followUpWindow: { endsAt: number; totalMs: number } | null;
  onToggleListening: () => void;
  onSubmitText: (text: string) => void;
  onStopSpeaking: () => void;
  /** Jarvis is listening, thinking, talking or a timer rings: show Stop */
  canStop?: boolean;
  onReplayResponse?: (text: string) => void;
  onClearHistory?: () => void;
}

const STATE_LABEL: Record<string, { text: string; className: string }> = {
  listening: { text: 'Listening', className: 'text-cyan-200 border-cyan-400/50 bg-cyan-950/40' },
  processing: { text: 'Thinking', className: 'text-amber-200 border-amber-400/50 bg-amber-950/50' },
  speaking: { text: 'Speaking', className: 'text-emerald-200 border-emerald-400/50 bg-emerald-950/40' },
  idle: { text: 'Standing by', className: 'text-amber-500 border-amber-800/60 bg-black/30' },
};

const clean = (text: string) => cleanForDisplay(text).replace(/\s+/g, ' ').trim();
const timeOf = (d: Date) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Shrinking bar for the follow-up window ("still listening") */
const WindowBar: React.FC<{ endsAt: number; totalMs: number }> = ({ endsAt, totalMs }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [endsAt]);
  const left = Math.max(0, endsAt - now);
  if (!left) return null;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-cyan-200/80 mb-1">
        <span>Still listening, go ahead</span>
        <span className="tabular-nums">{Math.ceil(left / 1000)}s</span>
      </div>
      <div className="h-[3px] rounded-full bg-cyan-950/80 overflow-hidden">
        <div className="h-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" style={{ width: `${(left / totalMs) * 100}%` }} />
      </div>
    </div>
  );
};

export const ConversationPanel: React.FC<ConversationPanelProps> = (p) => {
  const [text, setText] = useState('');
  const replyRef = useRef<HTMLDivElement>(null);
  const status = p.isProcessing ? 'processing' : p.isListening ? 'listening' : p.state === 'speaking' ? 'speaking' : 'idle';
  const label = STATE_LABEL[status];
  const heard = `${p.transcript} ${p.interimTranscript === '…' ? '' : p.interimTranscript}`.trim();
  const reply = clean(p.lastResponse);
  // The newest history entry is the current exchange once it's finished
  const earlier = p.history.length && p.history[0].query === p.lastQuery ? p.history.slice(1) : p.history;

  // Keep the end of a long streaming reply in view
  useEffect(() => {
    const el = replyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reply]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    p.onSubmitText(text.trim());
    setText('');
  };

  return (
    <aside className="w-full h-full flex flex-col hud-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-amber-900/40">
        <span className="hud-label">Conversation</span>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide ${label.className}`}>
            {status !== 'idle' && <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full bg-current align-middle animate-pulse" />}
            {label.text}
          </span>
          {p.history.length > 0 && p.onClearHistory && (
            <button onClick={p.onClearHistory} title="Clear conversation" className="p-1.5 rounded text-amber-600 hover:text-amber-300">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Current exchange */}
      <div className="px-5 py-4 border-b border-amber-900/30">
        {p.isListening ? (
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-300/80">You</div>
            <p className={`mt-1 text-[22px] leading-snug font-medium ${heard ? 'text-white' : 'text-cyan-100/50'}`}>
              {heard || (p.interimTranscript === '…' ? 'Hearing you…' : 'Listening…')}
            </p>
            {p.followUpWindow && !heard && <WindowBar endsAt={p.followUpWindow.endsAt} totalMs={p.followUpWindow.totalMs} />}
          </div>
        ) : p.lastQuery || reply || p.isProcessing ? (
          <div>
            {p.lastQuery && (
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-800/60 bg-amber-950/40 text-[10px] text-amber-300 shrink-0"
                  title={p.speakerConfidence !== undefined ? `Voice ID ${Math.round(p.speakerConfidence * 100)}%` : undefined}
                >
                  <Fingerprint className="w-3 h-3" />
                  {p.lastSpeaker || 'You'}
                </span>
                <p className="text-[15px] text-amber-200/90 leading-snug">{p.lastQuery}</p>
              </div>
            )}
            <div ref={replyRef} className="mt-3 max-h-[42vh] overflow-y-auto hud-scroll">
              {p.isProcessing && !reply ? (
                <div className="flex items-center gap-2 text-amber-300/80 text-[15px]">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-bounce [animation-delay:-0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-bounce [animation-delay:-0.1s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-bounce" />
                  </span>
                  Thinking…
                </div>
              ) : p.notice ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[14px] leading-snug text-amber-300">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  {p.notice}
                </p>
              ) : (
                <p className="text-[22px] leading-[1.4] text-amber-50 font-medium">{reply}</p>
              )}
            </div>
            {reply && !p.notice && (
              <div className="mt-3 flex items-center gap-2">
                {p.canStop ? (
                  <button
                    onClick={p.onStopSpeaking}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-red-500/50 text-red-200 text-[12px] hover:bg-red-950/40"
                  >
                    <Square className="w-3 h-3" /> Stop
                  </button>
                ) : (
                  p.onReplayResponse && (
                    <button
                      onClick={() => p.onReplayResponse?.(p.lastResponse)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-800/60 text-amber-300 text-[12px] hover:bg-amber-950/50"
                    >
                      <RotateCcw className="w-3 h-3" /> Repeat
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="py-2">
            <p className="text-[20px] text-amber-100/90 font-medium">How can I help?</p>
            <p className="mt-1 text-[13px] text-amber-500/80">Say “Hey Jarvis”, press Space, or type below.</p>
          </div>
        )}
      </div>

      {/* Earlier */}
      <div className="flex-1 min-h-0 overflow-y-auto hud-scroll px-5 py-3 space-y-3">
        {earlier.length > 0 && <div className="hud-label !text-[9px] !text-amber-600/80">Earlier</div>}
        {earlier.map((h, i) => (
          <div key={`${h.timestamp.toString()}-${i}`} className="group">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] text-amber-300/80 truncate">{h.query}</p>
              <span className="text-[10px] text-amber-700 shrink-0">{timeOf(h.timestamp)}</span>
            </div>
            <div className="flex items-start gap-2">
              <p className="text-[13.5px] text-amber-100/70 leading-snug line-clamp-3 flex-1">{clean(h.response)}</p>
              {p.onReplayResponse && (
                <button
                  onClick={() => p.onReplayResponse?.(h.response)}
                  title="Say it again"
                  className="opacity-0 group-hover:opacity-100 p-1 text-amber-500 hover:text-amber-200 transition-opacity"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-t border-amber-900/40 bg-black/30">
        <button
          type="button"
          onClick={p.onToggleListening}
          title="Talk (Space)"
          className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shrink-0 ${
            p.isListening
              ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,0.6)]'
              : 'border-amber-600/60 bg-amber-950/40 text-amber-200 hover:border-amber-400'
          }`}
        >
          <Mic className="w-4 h-4" />
        </button>
        {p.canStop && (
          <button
            type="button"
            onClick={p.onStopSpeaking}
            title="Stop (Esc)"
            aria-label="Stop"
            className="w-10 h-10 rounded-full flex items-center justify-center border border-red-500/60 bg-red-950/40 text-red-200 hover:bg-red-900/50 hover:border-red-400 shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 min-w-0 bg-black/40 border border-amber-900/60 focus:border-amber-500/70 rounded-full px-4 py-2 text-[14px] text-amber-100 placeholder-amber-700 outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          title="Send"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500 text-black disabled:opacity-30 hover:bg-amber-400 shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
};
