// More library widgets.
//   From n8n (your data, via /api/feed): Shopping list, Reminders, Smart home, Deliveries,
//     Doorbell log, Portfolio, and Photo frame (album mode).
//   From public sources (no setup): Headlines, Markets, Sports, Commute, Photo frame (topic mode).
import React, { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Lock, LockOpen, Plus, Power, Thermometer, Trash2, Video } from 'lucide-react';
import { notifyAuthRequired } from '../../services/auth';
import { getLocation } from '../../services/weather';
import { applyScreenDirective } from '../../services/screenController';
import { normalizeCameraName } from '../../services/directives';
import { Card, inputClass, useNow, useWidgetSetting } from './ExtraWidgets';
import { everyWhileVisible } from './GlanceColumn';
import { voiceBiometrics } from '../../services/voiceBiometrics';

/**
 * Added by someone other than the owner? n8n's flag if it sent one (byGuest), otherwise compare
 * who added it with the owner's name from voice ID.
 */
function isGuestAddition(item: { addedBy?: string; byGuest?: boolean | null }): boolean {
  if (typeof item.byGuest === 'boolean') return item.byGuest;
  const owner = voiceBiometrics.getOwnerProfile()?.name?.trim().toLowerCase();
  return Boolean(item.addedBy && owner && item.addedBy.trim().toLowerCase() !== owner);
}

const GUEST_STYLE = 'italic text-sky-200/85';
const addedTitle = (item: { addedBy?: string }, guest: boolean) => (guest ? `Added by ${item.addedBy || 'a guest'}` : item.addedBy ? `Added by ${item.addedBy}` : undefined);

/** Shown under a list only when it has guest additions */
const GuestKey: React.FC = () => <div className="pt-1 text-[10.5px] text-sky-300/70 italic">Italic blue: added by a guest</div>;

// ---------------------------------------------------------------------------- data helpers

type Status = 'loading' | 'ok' | 'not_configured' | 'error';

/** GET a JSON route now and every `intervalMs` while visible. `reload()` refetches at once. */
function usePolled<T>(url: string | null, intervalMs: number): { data: T | null; status: Status; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(retry);
      let failed = false;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.status === 401) return notifyAuthRequired();
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setData(body as T);
          setStatus('ok');
        } else {
          failed = body.error !== 'not_configured';
          // Keep showing the last good data through a temporary failure
          setStatus((s) => (failed && s === 'ok' ? s : body.error === 'not_configured' ? 'not_configured' : 'error'));
        }
      } catch {
        failed = true;
        if (!cancelled) setStatus((s) => (s === 'ok' ? s : 'error'));
      }
      // A failed load tries again in a minute rather than waiting for the next refresh
      if (failed && !cancelled && intervalMs > 60_000) retry = setTimeout(() => void load(), 60_000);
    };
    const stop = everyWhileVisible(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      stop();
    };
  }, [url, intervalMs, tick]);
  return { data, status, reload: useCallback(() => setTick((n) => n + 1), []) };
}

async function feedAction(name: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/feed?name=${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) notifyAuthRequired();
    return res.ok;
  } catch {
    return false;
  }
}

const Muted: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="text-[13px] text-amber-500/80 leading-snug">{children}</div>;

/** What to show while a feed isn't ready */
const FeedState: React.FC<{ status: Status; feed: string; what: string }> = ({ status, feed, what }) =>
  status === 'loading' ? (
    <Muted>Loading {what}…</Muted>
  ) : status === 'not_configured' ? (
    <Muted>
      Not connected yet: needs the n8n <span className="font-mono-tech text-amber-300">{feed}</span> feed (see README, “Widget feeds”).
    </Muted>
  ) : (
    <Muted>{what.charAt(0).toUpperCase() + what.slice(1)} unavailable right now.</Muted>
  );

function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------- Shopping list

interface ShoppingItem {
  id: string;
  name: string;
  checked: boolean;
  qty: string;
  addedBy?: string;
  byGuest?: boolean | null;
}

export const ShoppingWidget: React.FC = () => {
  const { data, status, reload } = usePolled<{ items: ShoppingItem[] }>('/api/feed?name=shopping', 2 * 60_000);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState('');
  const items = (data?.items || []).map((i) => (i.id in optimistic ? { ...i, checked: optimistic[i.id] } : i));
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const toggle = async (i: ShoppingItem) => {
    setOptimistic((o) => ({ ...o, [i.id]: !i.checked }));
    await feedAction('shopping', { action: 'check', id: i.id, checked: !i.checked });
    reload();
  };
  return (
    <Card title="Shopping list" right={status === 'ok' ? <span className="text-[10.5px] text-amber-600">{open.length} to get</span> : null}>
      {status !== 'ok' ? (
        <FeedState status={status} feed="shopping" what="the shopping list" />
      ) : (
        <div className="space-y-1">
          {[...open, ...done].map((i) => {
            const guest = isGuestAddition(i);
            return (
              <button key={i.id} onClick={() => void toggle(i)} title={addedTitle(i, guest)} className="w-full flex items-center gap-2.5 py-1 text-left group">
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    i.checked ? 'bg-amber-500/80 border-amber-400' : guest ? 'border-sky-500/70 group-hover:border-sky-300' : 'border-amber-600 group-hover:border-amber-300'
                  }`}
                >
                  {i.checked && <Check className="w-3 h-3 text-black" />}
                </span>
                <span className={`flex-1 truncate text-[14px] ${i.checked ? 'line-through text-amber-700' : guest ? GUEST_STYLE : 'text-amber-50'} ${i.checked && guest ? 'italic' : ''}`}>
                  {i.name}
                </span>
                {i.qty && <span className="text-[11.5px] text-amber-500">×{i.qty}</span>}
              </button>
            );
          })}
          {open.some(isGuestAddition) && <GuestKey />}
          {items.length === 0 && <Muted>The list is empty.</Muted>}
          <form
            className="flex items-center gap-2 pt-1"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = adding.trim();
              if (!name) return;
              setAdding('');
              await feedAction('shopping', { action: 'add', name });
              reload();
            }}
          >
            <input className={inputClass} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add an item…" />
            <button type="submit" disabled={!adding.trim()} className="p-1.5 rounded-full bg-amber-500 text-black disabled:opacity-30" aria-label="Add item">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Reminders / to-dos

interface Task {
  id: string;
  title: string;
  due: string;
  done: boolean;
  list: string;
  addedBy?: string;
  byGuest?: boolean | null;
}

export const TasksWidget: React.FC = () => {
  const now = useNow(60_000);
  const { data, status, reload } = usePolled<{ tasks: Task[] }>('/api/feed?name=tasks', 3 * 60_000);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const tasks = (data?.tasks || []).filter((t) => !t.done && !completed.has(t.id)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const today = now.toISOString().slice(0, 10);
  return (
    <Card title="Reminders">
      {status !== 'ok' ? (
        <FeedState status={status} feed="tasks" what="reminders" />
      ) : tasks.length === 0 ? (
        <Muted>All done.</Muted>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((t) => {
            const dueDay = t.due.slice(0, 10);
            const overdue = t.due && dueDay < today;
            const guest = isGuestAddition(t);
            return (
              <div key={t.id} className="flex items-start gap-2.5" title={addedTitle(t, guest)}>
                <button
                  onClick={async () => {
                    setCompleted((s) => new Set(s).add(t.id));
                    await feedAction('tasks', { action: 'complete', id: t.id });
                    reload();
                  }}
                  className="mt-0.5 w-4 h-4 rounded-full border border-amber-600 hover:border-amber-300 hover:bg-amber-500/30 shrink-0"
                  aria-label={`Mark "${t.title}" done`}
                  title="Mark done"
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] leading-snug ${guest ? GUEST_STYLE : 'text-amber-50'}`}>{t.title}</div>
                  {(t.due || t.list) && (
                    <div className={`text-[11px] ${overdue ? 'text-red-300' : 'text-amber-600'}`}>
                      {t.due ? (dueDay === today ? 'Today' : overdue ? `Overdue · ${new Date(t.due).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : new Date(t.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) : ''}
                      {t.due && t.list ? ' · ' : ''}
                      {t.list}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {tasks.some(isGuestAddition) && <GuestKey />}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Smart home

interface Device {
  id: string;
  name: string;
  type: string;
  state: string;
  value: number | null;
  unit: string;
  room: string;
  controllable: boolean;
}

const isOn = (d: Device) => /^(on|open|playing|unlocked|heat|cool|auto)$/i.test(d.state);

export const SmartHomeWidget: React.FC = () => {
  const { data, status, reload } = usePolled<{ devices: Device[] }>('/api/feed?name=home', 60_000);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [confirmUnlock, setConfirmUnlock] = useState<string | null>(null);
  const devices = (data?.devices || []).map((d) => (d.id in pending ? { ...d, state: pending[d.id] } : d));

  const toggle = async (d: Device) => {
    if (!d.controllable) return;
    // Unlocking needs a second tap within a few seconds
    if (d.type === 'lock' && /locked/i.test(d.state) && !/unlocked/i.test(d.state) && confirmUnlock !== d.id) {
      setConfirmUnlock(d.id);
      setTimeout(() => setConfirmUnlock((c) => (c === d.id ? null : c)), 4000);
      return;
    }
    setConfirmUnlock(null);
    const next = d.type === 'lock' ? (/unlocked/i.test(d.state) ? 'locked' : 'unlocked') : isOn(d) ? 'off' : 'on';
    setPending((p) => ({ ...p, [d.id]: next }));
    await feedAction('home', { action: 'toggle', id: d.id });
    setTimeout(() => {
      setPending((p) => {
        const { [d.id]: _gone, ...rest } = p;
        void _gone;
        return rest;
      });
      reload();
    }, 1500);
  };

  return (
    <Card title="Smart home">
      {status !== 'ok' ? (
        <FeedState status={status} feed="home" what="devices" />
      ) : devices.length === 0 ? (
        <Muted>No devices.</Muted>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {devices.map((d) => {
            const on = d.type === 'lock' ? /unlocked/i.test(d.state) : isOn(d);
            const Icon = d.type === 'lock' ? (on ? LockOpen : Lock) : d.type === 'thermostat' || d.type === 'sensor' ? Thermometer : Power;
            const showValue = d.value !== null && (d.type === 'thermostat' || d.type === 'sensor');
            return (
              <button
                key={d.id}
                onClick={() => void toggle(d)}
                disabled={!d.controllable || d.type === 'thermostat'}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                  confirmUnlock === d.id
                    ? 'border-red-400 bg-red-950/40'
                    : on
                      ? 'border-amber-400/70 bg-amber-500/15'
                      : 'border-amber-900/60 bg-black/30'
                } ${d.controllable && d.type !== 'thermostat' ? 'hover:border-amber-300' : 'cursor-default'}`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-amber-200' : 'text-amber-700'}`} />
                <span className="min-w-0">
                  <span className="block text-[13px] text-amber-50 truncate">{d.name}</span>
                  <span className={`block text-[11px] truncate ${confirmUnlock === d.id ? 'text-red-200' : 'text-amber-500'}`}>
                    {confirmUnlock === d.id ? 'Tap again to unlock' : showValue ? `${d.value}${d.unit}` : d.state || '—'}
                    {d.room && confirmUnlock !== d.id ? ` · ${d.room}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Deliveries

interface Pkg {
  id: string;
  title: string;
  carrier: string;
  status: string;
  eta: string;
  url: string;
}

export const DeliveriesWidget: React.FC = () => {
  const { data, status } = usePolled<{ packages: Pkg[] }>('/api/feed?name=deliveries', 15 * 60_000);
  const pkgs = data?.packages || [];
  return (
    <Card title="Deliveries">
      {status !== 'ok' ? (
        <FeedState status={status} feed="deliveries" what="deliveries" />
      ) : pkgs.length === 0 ? (
        <Muted>Nothing on the way.</Muted>
      ) : (
        <div className="space-y-2">
          {pkgs.map((p) => {
            const delivered = /delivered/i.test(p.status);
            const etaText = p.eta ? new Date(p.eta.length === 10 ? `${p.eta}T12:00:00` : p.eta).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';
            return (
              <div key={p.id} className="flex items-start gap-2.5">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${delivered ? 'bg-emerald-400' : /out for delivery/i.test(p.status) ? 'bg-cyan-300 animate-pulse' : 'bg-amber-500'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] text-amber-50 truncate">{p.title}</div>
                  <div className="text-[11.5px] text-amber-500 truncate">
                    {[p.status, !delivered && etaText ? `ETA ${etaText}` : '', p.carrier].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="p-1 text-amber-600 hover:text-amber-300" aria-label="Tracking page">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Doorbell log

interface DoorEvent {
  id: string;
  time: string;
  camera: string;
  label: string;
  imageUrl: string;
}

export const DoorbellWidget: React.FC = () => {
  const now = useNow(30_000);
  const { data, status } = usePolled<{ events: DoorEvent[] }>('/api/feed?name=doorbell', 60_000);
  const events = (data?.events || []).slice().sort((a, b) => b.time.localeCompare(a.time)).slice(0, 12);
  return (
    <Card title="Doorbell log">
      {status !== 'ok' ? (
        <FeedState status={status} feed="doorbell" what="camera events" />
      ) : events.length === 0 ? (
        <Muted>All quiet.</Muted>
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-2.5">
              {e.imageUrl ? (
                <img src={e.imageUrl} alt="" referrerPolicy="no-referrer" className="w-12 h-9 rounded object-cover border border-amber-900/60 shrink-0" />
              ) : (
                <span className="w-12 h-9 rounded border border-amber-900/60 bg-black/30 flex items-center justify-center shrink-0">
                  <Video className="w-3.5 h-3.5 text-amber-700" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-amber-50 truncate">{e.label || 'Motion'}</div>
                <div className="text-[11px] text-amber-500 truncate">
                  {e.camera ? `${e.camera} · ` : ''}
                  {ago(e.time, now)}
                </div>
              </div>
              {e.camera && normalizeCameraName(e.camera) && (
                <button
                  onClick={() => applyScreenDirective({ type: 'show-camera', camera: normalizeCameraName(e.camera)! })}
                  className="px-2 py-0.5 rounded-full border border-amber-700/60 text-[11px] text-amber-300 hover:border-amber-400"
                >
                  View
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Photo frame

interface Photo {
  url: string;
  caption: string;
}

export const PhotoFrameWidget: React.FC = () => {
  const [cfg, setCfg] = useWidgetSetting<{ source: 'topic' | 'album'; topic: string; seconds: number }>('photoFrame', {
    source: 'topic',
    topic: 'mountain landscape',
    seconds: 20,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cfg);
  const album = usePolled<{ photos: Photo[] }>(cfg.source === 'album' ? '/api/feed?name=photos' : null, 60 * 60_000);
  const topic = usePolled<{ results: { url: string; title: string; creator: string }[] }>(
    cfg.source === 'topic' ? `/api/image-search?count=12&q=${encodeURIComponent(cfg.topic)}` : null,
    6 * 60 * 60_000
  );
  const photos: Photo[] =
    cfg.source === 'album' ? album.data?.photos || [] : (topic.data?.results || []).map((r) => ({ url: r.url, caption: [r.title, r.creator && `by ${r.creator}`].filter(Boolean).join(' ') }));
  const status = cfg.source === 'album' ? album.status : topic.status;
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const usable = photos.filter((p) => !failed.has(p.url));

  useEffect(() => {
    if (usable.length < 2) return;
    const t = setInterval(() => setIndex((i) => i + 1), Math.max(5, cfg.seconds) * 1000);
    return () => clearInterval(t);
  }, [usable.length, cfg.seconds]);
  const current = usable.length ? usable[index % usable.length] : null;

  return (
    <div className="hud-panel h-full overflow-hidden relative group">
      {editing ? (
        <div className="p-4 space-y-2">
          <div className="hud-label">Photo frame</div>
          <div className="flex gap-2 text-[12.5px]">
            {(['topic', 'album'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setDraft({ ...draft, source: s })}
                className={`px-2.5 py-1 rounded-full border ${draft.source === s ? 'border-amber-400 text-amber-100 bg-amber-950/50' : 'border-amber-800 text-amber-500'}`}
              >
                {s === 'topic' ? 'Free photos of…' : 'My album (n8n)'}
              </button>
            ))}
          </div>
          {draft.source === 'topic' && <input className={inputClass} value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} placeholder="mountain landscape" />}
          <label className="flex items-center gap-2 text-[12.5px] text-amber-400">
            Change every
            <input className={`${inputClass} !w-20`} type="number" min={5} max={3600} value={draft.seconds} onChange={(e) => setDraft({ ...draft, seconds: Number(e.target.value) || 20 })} />
            seconds
          </label>
          <button
            onClick={() => {
              setCfg({ ...draft, topic: draft.topic.trim().slice(0, 80) || 'landscape' });
              setFailed(new Set());
              setIndex(0);
              setEditing(false);
            }}
            className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold"
          >
            Save
          </button>
        </div>
      ) : current ? (
        <>
          {usable.map((p, i) => (
            <img
              key={p.url}
              src={p.url}
              alt={p.caption}
              referrerPolicy="no-referrer"
              onError={() => setFailed((f) => new Set(f).add(p.url))}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1500ms] ${i === index % usable.length ? 'opacity-100' : 'opacity-0'}`}
            />
          ))}
          {current.caption && (
            <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 bg-gradient-to-t from-black/80 to-transparent text-[10.5px] text-amber-200/80 truncate">{current.caption}</div>
          )}
        </>
      ) : (
        <div className="p-4">
          <div className="hud-label">Photo frame</div>
          <div className="mt-2">
            {status === 'loading' ? <Muted>Finding photos…</Muted> : cfg.source === 'album' ? <FeedState status={status} feed="photos" what="photos" /> : <Muted>No photos found for “{cfg.topic}”.</Muted>}
          </div>
        </div>
      )}
      <button
        onClick={() => {
          setDraft(cfg);
          setEditing((v) => !v);
        }}
        className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 border border-amber-800/60 text-[11px] text-amber-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        {editing ? 'Close' : 'Settings'}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------- Headlines

const NEWS_SOURCES: { key: string; name: string }[] = [
  { key: 'npr', name: 'NPR' },
  { key: 'bbc', name: 'BBC' },
  { key: 'bbcWorld', name: 'BBC World' },
  { key: 'bbcTech', name: 'BBC Tech' },
  { key: 'nyt', name: 'NY Times' },
  { key: 'guardian', name: 'Guardian' },
  { key: 'ars', name: 'Ars Technica' },
  { key: 'verge', name: 'The Verge' },
  { key: 'hn', name: 'Hacker News' },
  { key: 'espn', name: 'ESPN' },
  { key: 'ksl', name: 'KSL (Utah)' },
];

export const HeadlinesWidget: React.FC = () => {
  const now = useNow(60_000);
  const [sources, setSources] = useWidgetSetting<string[]>('headlines', ['npr', 'bbc']);
  const [editing, setEditing] = useState(false);
  const { data, status } = usePolled<{ items: { title: string; link: string; source: string; published: string }[]; failed: string[] }>(
    sources.length ? `/api/news?sources=${sources.join(',')}` : null,
    15 * 60_000
  );
  return (
    <Card title="Headlines" onSettings={() => setEditing((v) => !v)} settingsOpen={editing}>
      {editing ? (
        <div className="grid grid-cols-2 gap-1.5">
          {NEWS_SOURCES.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-[13px] text-amber-200">
              <input
                type="checkbox"
                className="accent-amber-400"
                checked={sources.includes(s.key)}
                onChange={(e) => setSources(e.target.checked ? [...sources, s.key].slice(0, 6) : sources.filter((x) => x !== s.key))}
              />
              {s.name}
            </label>
          ))}
        </div>
      ) : !sources.length ? (
        <Muted>Pick some sources in settings.</Muted>
      ) : status !== 'ok' ? (
        <Muted>{status === 'loading' ? 'Loading headlines…' : 'Headlines unavailable right now.'}</Muted>
      ) : (
        <div className="space-y-2">
          {(data?.items || []).slice(0, 15).map((i, n) => (
            <a key={n} href={i.link || undefined} target="_blank" rel="noopener noreferrer" className="block group">
              <div className="text-[14px] text-amber-50 leading-snug group-hover:text-amber-200">{i.title}</div>
              <div className="text-[11px] text-amber-600">
                {i.source}
                {i.published ? ` · ${ago(i.published, now)}` : ''}
              </div>
            </a>
          ))}
          {data?.failed?.length ? <div className="text-[11px] text-amber-700">Couldn’t reach: {data.failed.join(', ')}</div> : null}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Markets

export const MarketsWidget: React.FC = () => {
  const [symbols, setSymbols] = useWidgetSetting<string[]>('markets', ['^GSPC', '^IXIC', 'AAPL', 'BTC-USD', 'ETH-USD']);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { data, status } = usePolled<{ quotes: { symbol: string; name: string; price: number; changePct: number; currency: string }[]; failed: string[] }>(
    symbols.length ? `/api/markets?symbols=${encodeURIComponent(symbols.join(','))}` : null,
    5 * 60_000
  );
  const fmt = (p: number) => (p >= 1000 ? p.toLocaleString([], { maximumFractionDigits: 0 }) : p.toLocaleString([], { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
  return (
    <Card
      title="Markets"
      onSettings={() => {
        setDraft(symbols.join(', '));
        setEditing((v) => !v);
      }}
      settingsOpen={editing}
    >
      {editing ? (
        <div className="space-y-2">
          <label className="block text-[12px] text-amber-400">Symbols, comma separated (^GSPC = S&amp;P 500, ^IXIC = Nasdaq, BTC-USD = Bitcoin)</label>
          <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button
            onClick={() => {
              setSymbols(draft.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[\^A-Z0-9.=-]{1,15}$/.test(s)).slice(0, 12));
              setEditing(false);
            }}
            className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold"
          >
            Save
          </button>
        </div>
      ) : status !== 'ok' ? (
        <Muted>{status === 'loading' ? 'Loading prices…' : 'Prices unavailable right now.'}</Muted>
      ) : (
        <div className="space-y-1">
          {(data?.quotes || []).map((q) => {
            const up = q.changePct >= 0;
            const label = q.symbol === '^GSPC' ? 'S&P 500' : q.symbol === '^IXIC' ? 'Nasdaq' : q.symbol === '^DJI' ? 'Dow' : q.symbol.replace(/-USD$/, '');
            return (
              <div key={q.symbol} className="flex items-baseline justify-between gap-3" title={q.name}>
                <span className="text-[13.5px] text-amber-200 truncate">{label}</span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-[14px] text-amber-50">{fmt(q.price)}</span>
                  <span className={`text-[12px] w-[58px] text-right ${up ? 'text-emerald-300' : 'text-red-300'}`}>
                    {up ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
                  </span>
                </span>
              </div>
            );
          })}
          {data?.failed?.length ? <div className="text-[11px] text-amber-700">Not found: {data.failed.join(', ')}</div> : null}
          <div className="pt-1 text-[10px] text-amber-700">Prices may be delayed.</div>
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Portfolio

interface Position {
  id: string;
  symbol: string;
  name: string;
  weightPct: number | null;
  gainPct: number | null;
  dayChangePct: number | null;
}

/** Today's change, two decimals like a brokerage app: "+1.24%" / "−0.37%" */
const dayPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const TODAY_TITLE = "Today's change (crypto: last 24 hours)";

/** "+12.4%" / "−3.1%" */
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
const gainClass = (v: number) => (v > 0 ? 'text-emerald-300' : v < 0 ? 'text-red-300' : 'text-amber-200');

/** Read-only: total gain since purchase, cash share and the biggest holdings. Percentages only. */
export const PortfolioWidget: React.FC = () => {
  const { data, status } = usePolled<{ updatedAt: string; totalGainPct: number | null; cashPct: number | null; dayChangePct: number | null; positions: Position[] }>(
    '/api/feed?name=portfolio',
    15 * 60_000
  );
  const now = useNow(30_000);
  const positions = (data?.positions || []).slice(0, 10);
  const maxWeight = Math.max(1, ...positions.map((p) => p.weightPct ?? 0));
  return (
    <Card title="Portfolio" right={status === 'ok' && data?.updatedAt ? <span className="text-[10.5px] text-amber-600">updated {ago(data.updatedAt, now)}</span> : null}>
      {status !== 'ok' ? (
        <FeedState status={status} feed="portfolio" what="the portfolio" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-5">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-amber-600" title="Gain on the positions you hold now; excludes sold positions and dividends">Unrealized <span className="normal-case tracking-normal">(current holdings)</span></div>
              <div className={`text-[26px] leading-none font-semibold tabular-nums ${data?.totalGainPct != null ? gainClass(data.totalGainPct) : 'text-amber-700'}`}>
                {data?.totalGainPct != null ? signedPct(data.totalGainPct) : '—'}
              </div>
              {data?.dayChangePct != null && (
                <div className={`mt-1 text-[12.5px] tabular-nums ${gainClass(data.dayChangePct)}`} title={TODAY_TITLE}>
                  {data.dayChangePct > 0 ? '▲' : data.dayChangePct < 0 ? '▼' : ''} {dayPct(data.dayChangePct)} <span className="text-amber-500">Today</span>
                </div>
              )}
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-amber-600">Cash</div>
              <div className="text-[17px] leading-none text-amber-100 tabular-nums">{data?.cashPct != null ? `${data.cashPct.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
          {positions.length === 0 ? (
            <Muted>No positions.</Muted>
          ) : (
            <div className="space-y-1.5">
              {positions.map((p) => (
                <div key={p.id} title={p.name || p.symbol}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[13.5px] text-amber-100 font-mono-tech">{p.symbol || p.name}</span>
                      {p.dayChangePct != null && (
                        <span className={`text-[11px] tabular-nums shrink-0 ${gainClass(p.dayChangePct)}`} title={TODAY_TITLE}>
                          {dayPct(p.dayChangePct)}
                        </span>
                      )}
                      {p.symbol && p.name && <span className="text-[11px] text-amber-600 truncate">{p.name}</span>}
                    </span>
                    <span className="flex items-baseline gap-2 tabular-nums shrink-0">
                      <span className="text-[11.5px] text-amber-500">{p.weightPct != null ? `${p.weightPct.toFixed(1)}%` : ''}</span>
                      <span className={`text-[12.5px] w-[58px] text-right ${p.gainPct != null ? gainClass(p.gainPct) : 'text-amber-700'}`}>
                        {p.gainPct != null ? signedPct(p.gainPct) : '—'}
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 h-[3px] rounded-full bg-amber-900/40 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400/60" style={{ width: `${Math.max(2, ((p.weightPct ?? 0) / maxWeight) * 100)}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-1 text-[10px] text-amber-700">Today next to each symbol · weight · gain since purchase</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Sports

const LEAGUES: { key: string; name: string }[] = [
  { key: 'football/nfl', name: 'NFL' },
  { key: 'basketball/nba', name: 'NBA' },
  { key: 'baseball/mlb', name: 'MLB' },
  { key: 'hockey/nhl', name: 'NHL' },
  { key: 'soccer/usa.1', name: 'MLS' },
  { key: 'basketball/wnba', name: 'WNBA' },
  { key: 'football/college-football', name: 'College football' },
  { key: 'basketball/mens-college-basketball', name: "Men's college basketball" },
  { key: 'soccer/eng.1', name: 'Premier League' },
];

interface TeamInfo {
  key: string;
  name: string;
  abbr: string;
  logo: string;
  color: string;
  record: string;
  game: { name: string; date: string; state: 'pre' | 'in' | 'post'; detail: string; competitors: { abbr: string; score: string; logo: string; winner: boolean }[] } | null;
}

export const SportsWidget: React.FC = () => {
  const [teams, setTeams] = useWidgetSetting<string[]>('sports', ['football/nfl/den', 'basketball/nba/utah', 'hockey/nhl/uta']);
  const [editing, setEditing] = useState(false);
  const [league, setLeague] = useState(LEAGUES[0].key);
  const leagueTeams = usePolled<{ teams: { abbr: string; name: string }[] }>(editing ? `/api/sports?league=${league}` : null, 24 * 60 * 60_000);
  const { data, status } = usePolled<{ teams: TeamInfo[]; failed: string[] }>(teams.length ? `/api/sports?teams=${teams.join(',')}` : null, 5 * 60_000);
  return (
    <Card title="Sports" onSettings={() => setEditing((v) => !v)} settingsOpen={editing}>
      {editing ? (
        <div className="space-y-2">
          {teams.map((k) => (
            <div key={k} className="flex items-center justify-between text-[13px] text-amber-100">
              {data?.teams.find((t) => t.key === k)?.name || k}
              <button onClick={() => setTeams(teams.filter((t) => t !== k))} className="p-1 text-amber-600 hover:text-red-300" aria-label="Remove team">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <select className={inputClass} value={league} onChange={(e) => setLeague(e.target.value)} aria-label="League">
              {LEAGUES.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value=""
              onChange={(e) => e.target.value && setTeams([...teams, `${league}/${e.target.value}`].slice(0, 8))}
              aria-label="Add a team"
            >
              <option value="">{leagueTeams.status === 'loading' ? 'Loading teams…' : 'Add a team…'}</option>
              {(leagueTeams.data?.teams || [])
                .filter((t) => !teams.includes(`${league}/${t.abbr}`))
                .map((t) => (
                  <option key={t.abbr} value={t.abbr}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      ) : !teams.length ? (
        <Muted>Add your teams in settings.</Muted>
      ) : status !== 'ok' ? (
        <Muted>{status === 'loading' ? 'Loading scores…' : 'Scores unavailable right now.'}</Muted>
      ) : (
        <div className="space-y-2.5">
          {(data?.teams || []).map((t) => {
            const g = t.game;
            const when = g?.date ? new Date(g.date) : null;
            return (
              <div key={t.key} className="flex items-center gap-2.5">
                {t.logo ? <img src={t.logo} alt="" className="w-8 h-8 object-contain shrink-0" /> : <span className="w-8 h-8 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] text-amber-50 truncate">{t.name}</span>
                    <span className="text-[11px] text-amber-500 tabular-nums">{t.record}</span>
                  </div>
                  {g && (
                    <div className="text-[12px] text-amber-400/90 truncate tabular-nums">
                      {g.state === 'pre'
                        ? `Next: ${g.name} · ${when ? when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : g.detail}`
                        : `${g.state === 'in' ? 'Live' : 'Final'}: ${g.competitors.map((c) => `${c.abbr} ${c.score}`).join(' – ')}${g.state === 'in' ? ` · ${g.detail}` : ''}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {data?.failed?.length ? <div className="text-[11px] text-amber-700">Couldn’t load: {data.failed.join(', ')}</div> : null}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Commute

export const CommuteWidget: React.FC = () => {
  const [cfg, setCfg] = useWidgetSetting<{ label: string; to: string }>('commute', { label: '', to: '' });
  const [editing, setEditing] = useState(!cfg.to);
  const [draft, setDraft] = useState(cfg);
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    void getLocation()
      .then((l) => setFrom(`${l.lat.toFixed(4)},${l.lon.toFixed(4)}`))
      .catch(() => setFrom(null));
  }, []);
  const url = cfg.to && from ? `/api/commute?from=${from}&to=${encodeURIComponent(cfg.to)}` : null;
  const { data, status } = usePolled<{ minutes: number; typicalMinutes: number | null; miles: number; traffic: boolean; source: string; destination: string }>(url, 10 * 60_000);
  const delay = data?.typicalMinutes ? data.minutes - data.typicalMinutes : 0;
  return (
    <Card
      title={cfg.label ? `Drive to ${cfg.label}` : 'Commute'}
      onSettings={() => {
        setDraft(cfg);
        setEditing((v) => !v);
      }}
      settingsOpen={editing}
    >
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.to.trim()) return;
            setCfg({ label: draft.label.trim().slice(0, 30), to: draft.to.trim().slice(0, 200) });
            setEditing(false);
          }}
        >
          <input className={inputClass} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Name (e.g. Work)" />
          <input className={inputClass} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="Address" />
          <div className="text-[11px] text-amber-600">From this device's location. Live traffic needs GOOGLE_MAPS_API_KEY.</div>
          <button type="submit" className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold">
            Save
          </button>
        </form>
      ) : !from ? (
        <Muted>Finding your location…</Muted>
      ) : status !== 'ok' || !data ? (
        <Muted>{status === 'loading' ? 'Working out the drive…' : 'Couldn’t work out the drive right now.'}</Muted>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-orbitron text-[40px] leading-none text-amber-50 tabular-nums">{data.minutes}</span>
            <span className="text-[14px] text-amber-300">min</span>
            {delay > 2 && <span className="text-[12px] text-red-300">+{delay} min traffic</span>}
          </div>
          <div className="mt-1 text-[12.5px] text-amber-400/90 truncate">
            {data.miles} mi · {data.destination}
          </div>
          <div className="text-[10.5px] text-amber-700">{data.traffic ? 'Live traffic · Google Maps' : 'Without traffic · OpenStreetMap'}</div>
        </div>
      )}
    </Card>
  );
};
