// A notification that arrived while Jarvis is open (push via the service worker)
import React, { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import type { PushNote } from '../services/push';

export const NotificationToast: React.FC<{ note: PushNote; onClose: () => void }> = ({ note, onClose }) => {
  // Urgent ones stay until dismissed; others fade after 10 s
  useEffect(() => {
    if (note.priority >= 5) return;
    const t = setTimeout(onClose, 10000);
    return () => clearTimeout(t);
  }, [note, onClose]);

  const open = () => {
    if (note.url && note.url !== '/') window.open(note.url, note.url.startsWith('/') ? '_self' : '_blank', 'noopener');
    onClose();
  };

  return (
    <div className="fixed z-[70] top-14 left-1/2 -translate-x-1/2 w-[min(440px,calc(100vw-24px))] pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200" role="status" aria-live="polite">
      <div className={`hud-panel px-4 py-3 flex items-start gap-3 ${note.priority >= 4 ? 'border-amber-400/80 shadow-[0_0_30px_rgba(245,158,11,0.35)]' : ''}`}>
        <Bell className={`w-4 h-4 mt-0.5 shrink-0 ${note.priority >= 4 ? 'text-amber-300 animate-pulse' : 'text-amber-500'}`} />
        <button onClick={open} className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-semibold text-amber-100 truncate">{note.title}</div>
          {note.body && <div className="text-[12px] text-amber-300/90 mt-0.5 line-clamp-3">{note.body}</div>}
        </button>
        <button onClick={onClose} className="p-1 rounded text-amber-600 hover:text-amber-200" aria-label="Dismiss notification">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
