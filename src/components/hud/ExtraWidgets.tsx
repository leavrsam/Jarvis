// Library widgets (added from "Add widgets"): camera, quick commands, world clocks, air & UV,
// sun & moon, week ahead, countdown, note, audio. Settings are per device (localStorage).
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { notifyAuthRequired } from '../../services/auth';
import { getLocation } from '../../services/weather';
import { applyScreenDirective } from '../../services/screenController';
import { normalizeCameraName } from '../../services/directives';
import { AudioSpectrumMeter } from '../AudioSpectrumMeter';
import { DEFAULT_EVENT_COLOR, everyWhileVisible, readCalendarChoice } from './GlanceColumn';
import type { JarvisAudioState } from '../../services/audioEngine';

// ---------------------------------------------------------------------------- shared bits

/** A setting kept on this device */
function useWidgetSetting<T>(key: string, fallback: T): [T, (v: T) => void] {
  const storageKey = `jarvis_widget_${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const save = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {}
  };
  return [value, save];
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const Card: React.FC<{
  title: string;
  right?: React.ReactNode;
  onSettings?: () => void;
  settingsOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ title, right, onSettings, settingsOpen, children, className = '' }) => (
  <div className={`hud-panel px-5 py-4 h-full flex flex-col min-h-0 ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="hud-label truncate">{title}</span>
      <span className="flex items-center gap-1.5">
        {right}
        {onSettings && (
          <button
            onClick={onSettings}
            title={settingsOpen ? 'Done' : 'Settings'}
            aria-label={settingsOpen ? 'Close settings' : `${title} settings`}
            className={`p-1 rounded ${settingsOpen ? 'text-amber-200' : 'text-amber-600 hover:text-amber-300'}`}
          >
            {settingsOpen ? <X className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </span>
    </div>
    <div className="mt-2 flex-1 min-h-0 overflow-y-auto hud-scroll">{children}</div>
  </div>
);

const inputClass =
  'w-full bg-black/40 border border-amber-900/60 focus:border-amber-500/70 rounded-lg px-2.5 py-1.5 text-[13px] text-amber-100 placeholder-amber-700 outline-none';

// ---------------------------------------------------------------------------- Camera

export const CameraWidget: React.FC = () => {
  const [camera, setCamera] = useWidgetSetting('camera', '');
  const [editing, setEditing] = useState(!camera);
  const [draft, setDraft] = useState(camera);
  const [src, setSrc] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'not_configured'>('idle');
  const srcRef = useRef<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    const load = async () => {
      setStatus((s) => (s === 'ok' ? s : 'loading'));
      try {
        const res = await fetch(`/api/camera?camera=${encodeURIComponent(camera)}`, { cache: 'no-store' });
        if (res.status === 401) return notifyAuthRequired();
        if (res.status === 503) {
          if (!cancelled) setStatus('not_configured');
          return;
        }
        if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) throw new Error(`HTTP ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        if (cancelled) return URL.revokeObjectURL(url);
        if (srcRef.current) URL.revokeObjectURL(srcRef.current);
        srcRef.current = url;
        setSrc(url);
        setCaption(res.headers.get('x-image-source') || '');
        setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    const stop = everyWhileVisible(() => void load(), 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [camera, reload]);

  useEffect(
    () => () => {
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    },
    []
  );

  return (
    <Card
      title={camera ? `Camera · ${camera}` : 'Camera'}
      onSettings={() => {
        setDraft(camera);
        setEditing((v) => !v);
      }}
      settingsOpen={editing}
      right={
        camera && !editing ? (
          <>
            {caption && <span className="text-[10.5px] text-amber-400/90 truncate max-w-[120px]">{caption}</span>}
            <button onClick={() => setReload((n) => n + 1)} className="p-1 text-amber-600 hover:text-amber-300" title="Refresh" aria-label="Refresh">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => applyScreenDirective({ type: 'show-camera', camera })}
              className="p-1 text-amber-600 hover:text-amber-300"
              title="Show on the big screen"
              aria-label="Show on the big screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : null
      }
    >
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = normalizeCameraName(draft);
            if (!name) return;
            setCamera(name);
            setEditing(false);
          }}
        >
          <label className="block text-[12px] text-amber-400">Camera name (as your n8n media webhook knows it)</label>
          <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="front door" autoFocus />
          <button type="submit" disabled={!normalizeCameraName(draft)} className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold disabled:opacity-40">
            Save
          </button>
        </form>
      ) : status === 'not_configured' ? (
        <div className="text-[12.5px] text-amber-500/80">Cameras aren't connected yet (JARVIS_MEDIA_URL).</div>
      ) : src ? (
        <img src={src} alt={`${camera} camera`} className={`w-full h-full object-cover rounded-lg ${status === 'error' ? 'opacity-40' : ''}`} />
      ) : (
        <div className="text-[13px] text-amber-500/80">{status === 'error' ? "Couldn't load the camera." : 'Connecting…'}</div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Quick commands

const DEFAULT_COMMANDS = ["What's the weather today?", "What's on my calendar today?", 'Set a timer for 10 minutes', 'Play some music', 'Good night, Jarvis'];

export const QuickCommandsWidget: React.FC<{ onSend: (text: string) => void }> = ({ onSend }) => {
  const [commands, setCommands] = useWidgetSetting<string[]>('quickCommands', DEFAULT_COMMANDS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <Card
      title="Quick commands"
      onSettings={() => {
        setDraft(commands.join('\n'));
        setEditing((v) => !v);
      }}
      settingsOpen={editing}
    >
      {editing ? (
        <div className="space-y-2">
          <label className="block text-[12px] text-amber-400">One command per line</label>
          <textarea className={`${inputClass} h-32 resize-none`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button
            onClick={() => {
              setCommands(draft.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12));
              setEditing(false);
            }}
            className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {commands.map((c) => (
            <button
              key={c}
              onClick={() => onSend(c)}
              className="px-3 py-1.5 rounded-full border border-amber-700/60 bg-amber-950/30 text-[13px] text-amber-100 hover:border-amber-400 hover:bg-amber-900/40 text-left"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- World clocks

const CITIES: { label: string; tz: string }[] = [
  { label: 'London', tz: 'Europe/London' },
  { label: 'New York', tz: 'America/New_York' },
  { label: 'Los Angeles', tz: 'America/Los_Angeles' },
  { label: 'Chicago', tz: 'America/Chicago' },
  { label: 'Denver', tz: 'America/Denver' },
  { label: 'Phoenix', tz: 'America/Phoenix' },
  { label: 'Honolulu', tz: 'Pacific/Honolulu' },
  { label: 'Anchorage', tz: 'America/Anchorage' },
  { label: 'Toronto', tz: 'America/Toronto' },
  { label: 'Mexico City', tz: 'America/Mexico_City' },
  { label: 'São Paulo', tz: 'America/Sao_Paulo' },
  { label: 'Paris', tz: 'Europe/Paris' },
  { label: 'Berlin', tz: 'Europe/Berlin' },
  { label: 'Madrid', tz: 'Europe/Madrid' },
  { label: 'Rome', tz: 'Europe/Rome' },
  { label: 'Athens', tz: 'Europe/Athens' },
  { label: 'Istanbul', tz: 'Europe/Istanbul' },
  { label: 'Dubai', tz: 'Asia/Dubai' },
  { label: 'Mumbai', tz: 'Asia/Kolkata' },
  { label: 'Singapore', tz: 'Asia/Singapore' },
  { label: 'Hong Kong', tz: 'Asia/Hong_Kong' },
  { label: 'Shanghai', tz: 'Asia/Shanghai' },
  { label: 'Tokyo', tz: 'Asia/Tokyo' },
  { label: 'Seoul', tz: 'Asia/Seoul' },
  { label: 'Sydney', tz: 'Australia/Sydney' },
  { label: 'Auckland', tz: 'Pacific/Auckland' },
  { label: 'UTC', tz: 'UTC' },
];

export const WorldClocksWidget: React.FC = () => {
  const now = useNow(15_000);
  const [zones, setZones] = useWidgetSetting<string[]>('worldClocks', ['Europe/London', 'America/New_York', 'Asia/Tokyo']);
  const [editing, setEditing] = useState(false);
  const label = (tz: string) => CITIES.find((c) => c.tz === tz)?.label || tz.split('/').pop()!.replace(/_/g, ' ');
  const localDay = now.getDate();
  return (
    <Card title="World clocks" onSettings={() => setEditing((v) => !v)} settingsOpen={editing}>
      {editing ? (
        <div className="space-y-2">
          {zones.map((tz) => (
            <div key={tz} className="flex items-center justify-between text-[13px] text-amber-100">
              {label(tz)}
              <button onClick={() => setZones(zones.filter((z) => z !== tz))} className="p-1 text-amber-600 hover:text-red-300" aria-label={`Remove ${label(tz)}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <select
            className={inputClass}
            value=""
            onChange={(e) => e.target.value && setZones([...zones, e.target.value].slice(0, 8))}
            aria-label="Add a city"
          >
            <option value="">Add a city…</option>
            {CITIES.filter((c) => !zones.includes(c.tz)).map((c) => (
              <option key={c.tz} value={c.tz}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          {zones.map((tz) => {
            let time = '';
            let day = 0;
            try {
              time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
              day = Number(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(now));
            } catch {
              time = '—';
            }
            const diff = day && day !== localDay ? (day > localDay || (localDay > 25 && day < 3) ? 'tomorrow' : 'yesterday') : '';
            return (
              <div key={tz} className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-amber-300/90 truncate">{label(tz)}</span>
                <span className="text-right">
                  <span className="font-orbitron text-[18px] text-amber-50 tabular-nums">{time}</span>
                  {diff && <span className="ml-1.5 text-[10.5px] text-amber-600">{diff}</span>}
                </span>
              </div>
            );
          })}
          {zones.length === 0 && <div className="text-[13px] text-amber-500/80">Add a city in settings.</div>}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Air quality & UV

interface AirData {
  aqi: number;
  pm25: number;
  ozone: number;
  uv: number;
  uvMax: number;
  place: string;
}

function aqiInfo(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Good', color: '#34d399' };
  if (aqi <= 100) return { label: 'Moderate', color: '#facc15' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', color: '#fb923c' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#f87171' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#c084fc' };
  return { label: 'Hazardous', color: '#be123c' };
}

function uvInfo(uv: number): { label: string; color: string } {
  if (uv < 3) return { label: 'Low', color: '#34d399' };
  if (uv < 6) return { label: 'Moderate', color: '#facc15' };
  if (uv < 8) return { label: 'High', color: '#fb923c' };
  if (uv < 11) return { label: 'Very high', color: '#f87171' };
  return { label: 'Extreme', color: '#c084fc' };
}

export const AirQualityWidget: React.FC = () => {
  const [data, setData] = useState<AirData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loc = await getLocation();
        const params = new URLSearchParams({
          latitude: loc.lat.toFixed(3),
          longitude: loc.lon.toFixed(3),
          current: 'us_aqi,pm2_5,ozone,uv_index',
          hourly: 'uv_index',
          forecast_days: '1',
          timezone: 'auto',
        });
        const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (cancelled) return;
        const uvs: number[] = (d.hourly?.uv_index || []).filter((v: unknown) => typeof v === 'number');
        setData({
          aqi: Math.round(d.current.us_aqi),
          pm25: Math.round(d.current.pm2_5),
          ozone: Math.round(d.current.ozone),
          uv: Math.round((d.current.uv_index ?? 0) * 10) / 10,
          uvMax: Math.round(Math.max(0, ...uvs) * 10) / 10,
          place: loc.place,
        });
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    const stop = everyWhileVisible(() => void load(), 30 * 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  if (!data)
    return (
      <Card title="Air & UV">
        <div className="text-[13px] text-amber-500/80">{error ? 'Air quality unavailable right now.' : 'Checking the air…'}</div>
      </Card>
    );
  const a = aqiInfo(data.aqi);
  const u = uvInfo(data.uv);
  return (
    <Card title="Air & UV" right={<span className="text-[10.5px] text-amber-600 truncate max-w-[140px]">{data.place}</span>}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] text-amber-500">Air quality</div>
          <div className="flex items-baseline gap-2">
            <span className="font-orbitron text-[30px] leading-tight tabular-nums" style={{ color: a.color }}>
              {data.aqi}
            </span>
            <span className="text-[10.5px] text-amber-600">US AQI</span>
          </div>
          <div className="text-[12.5px] leading-snug" style={{ color: a.color }}>
            {a.label}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] text-amber-500">UV index</div>
          <div className="font-orbitron text-[30px] leading-tight tabular-nums" style={{ color: u.color }}>
            {data.uv}
          </div>
          <div className="text-[12.5px]" style={{ color: u.color }}>
            {u.label}
            <span className="text-amber-600"> · max {data.uvMax}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11.5px] text-amber-500/80">
        PM2.5 {data.pm25} µg/m³ · Ozone {data.ozone} µg/m³
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------- Sun & moon

/** Moon phase 0..1 (0 = new, 0.5 = full) from the mean synodic month */
export function moonPhase(date: Date): number {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - knownNew;
  return (((days / synodic) % 1) + 1) % 1;
}

export function moonName(phase: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(phase * 8) % 8];
}

const MoonIcon: React.FC<{ phase: number; size?: number }> = ({ phase, size = 44 }) => {
  // Lit part: a circle with an elliptical terminator
  const r = size / 2 - 2;
  const c = size / 2;
  const k = Math.cos(phase * 2 * Math.PI); // 1 new → -1 full
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const d = `M ${c} ${c - r} A ${r} ${r} 0 0 ${sweepOuter} ${c} ${c + r} A ${rx} ${r} 0 0 ${sweepInner} ${c} ${c - r} Z`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="rgba(120,113,108,0.25)" stroke="rgba(251,191,36,0.35)" />
      <path d={d} fill="rgb(254,243,199)" />
    </svg>
  );
};

export const SunMoonWidget: React.FC = () => {
  const now = useNow(60_000);
  const [sun, setSun] = useState<{ rise: Date; set: Date; dayMs: number; deltaMs: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loc = await getLocation();
        const params = new URLSearchParams({
          latitude: loc.lat.toFixed(3),
          longitude: loc.lon.toFixed(3),
          daily: 'sunrise,sunset,daylight_duration',
          past_days: '1',
          forecast_days: '1',
          timezone: 'auto',
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        const offset = (Number(d.utc_offset_seconds) || 0) * 1000;
        const at = (t: string) => new Date(Date.parse(`${t}Z`) - offset);
        if (cancelled) return;
        const [yesterday, today] = d.daily.daylight_duration as number[];
        setSun({ rise: at(d.daily.sunrise[1]), set: at(d.daily.sunset[1]), dayMs: today * 1000, deltaMs: (today - yesterday) * 1000 });
      } catch {
        // stays on "Checking…"
      }
    };
    const stop = everyWhileVisible(() => void load(), 3 * 60 * 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  const phase = moonPhase(now);
  const illumination = Math.round(((1 - Math.cos(phase * 2 * Math.PI)) / 2) * 100);
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const hm = (ms: number) => `${Math.floor(ms / 3600000)} h ${Math.round((ms % 3600000) / 60000)} min`;
  return (
    <Card title="Sun & moon">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0 text-[13px] text-amber-200/90 space-y-0.5">
          {sun ? (
            <>
              <div className="flex justify-between"><span className="text-amber-500">Sunrise</span><span className="tabular-nums">{t(sun.rise)}</span></div>
              <div className="flex justify-between"><span className="text-amber-500">Sunset</span><span className="tabular-nums">{t(sun.set)}</span></div>
              <div className="flex justify-between"><span className="text-amber-500">Golden hour</span><span className="tabular-nums">{t(new Date(sun.set.getTime() - 3600000))}</span></div>
              <div className="flex justify-between"><span className="text-amber-500">Daylight</span><span className="tabular-nums">{hm(sun.dayMs)}</span></div>
              <div className="text-[11px] text-amber-600 text-right">
                {sun.deltaMs >= 0 ? '+' : '−'}
                {Math.abs(Math.round(sun.deltaMs / 60000 * 10) / 10)} min vs yesterday
              </div>
            </>
          ) : (
            <div className="text-amber-500/80">Checking the sky…</div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <MoonIcon phase={phase} />
          <span className="text-[11.5px] text-amber-300 text-center leading-tight">{moonName(phase)}</span>
          <span className="text-[10.5px] text-amber-600">{illumination}% lit</span>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------- Week ahead

interface WeekEvent {
  title: string;
  start: string;
  allDay: boolean;
  color: string;
  calendar: string;
}

export const WeekAheadWidget: React.FC = () => {
  const [events, setEvents] = useState<WeekEvent[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_configured' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
      const choice = readCalendarChoice();
      if (choice && choice.length) params.set('calendars', choice.join(','));
      try {
        const res = await fetch(`/api/calendar?${params}`, { cache: 'no-store' });
        if (res.status === 401) return notifyAuthRequired();
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(data.events)) {
          setEvents(data.events);
          setStatus('ok');
        } else setStatus(data.error === 'not_configured' ? 'not_configured' : 'error');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    const stop = everyWhileVisible(() => void load(), 15 * 60_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const days: { key: string; label: string; items: WeekEvent[] }[] = [];
  if (events) {
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const items = events.filter((e) => {
        if (e.allDay) return e.start.slice(0, 10) === key;
        const s = new Date(e.start);
        return s.getFullYear() === d.getFullYear() && s.getMonth() === d.getMonth() && s.getDate() === d.getDate();
      });
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      days.push({ key, label, items });
    }
  }
  return (
    <Card title="Week ahead">
      {status === 'loading' && <div className="text-[13px] text-amber-500/80">Checking your calendar…</div>}
      {status === 'not_configured' && <div className="text-[12.5px] text-amber-500/80">Calendar not connected yet (JARVIS_CALENDAR_URL).</div>}
      {status === 'error' && <div className="text-[13px] text-amber-500/80">Calendar unavailable right now.</div>}
      {status === 'ok' && (
        <div className="space-y-2.5">
          {days.map((d) => (
            <div key={d.key}>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-amber-600/90">{d.label}</div>
              {d.items.length === 0 ? (
                <div className="text-[12.5px] text-amber-700">Nothing scheduled</div>
              ) : (
                d.items.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[13px]" title={e.calendar || undefined}>
                    <span className="w-[56px] shrink-0 text-right tabular-nums text-amber-500">
                      {e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ backgroundColor: e.color || DEFAULT_EVENT_COLOR }} />
                    <span className="truncate text-amber-100/90">{e.title}</span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Countdown

function nextNewYear() {
  const y = new Date().getFullYear() + 1;
  return `${y}-01-01`;
}

export const CountdownWidget: React.FC = () => {
  const now = useNow(60_000);
  const [cfg, setCfg] = useWidgetSetting<{ label: string; date: string }>('countdown', { label: 'New Year', date: nextNewYear() });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cfg);
  const target = new Date(`${cfg.date}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  return (
    <Card
      title="Countdown"
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
            if (!draft.label.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return;
            setCfg({ label: draft.label.trim().slice(0, 40), date: draft.date });
            setEditing(false);
          }}
        >
          <input className={inputClass} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="What for?" />
          <input className={inputClass} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <button type="submit" className="px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold">
            Save
          </button>
        </form>
      ) : Number.isNaN(days) ? (
        <div className="text-[13px] text-amber-500/80">Pick a date in settings.</div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-orbitron text-[42px] leading-none text-amber-50 tabular-nums">{Math.abs(days)}</span>
            <span className="text-[14px] text-amber-300">{Math.abs(days) === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="mt-1 text-[14px] text-amber-200/90 truncate">
            {days > 0 ? `until ${cfg.label}` : days === 0 ? `${cfg.label} is today!` : `since ${cfg.label}`}
          </div>
          <div className="text-[11.5px] text-amber-600">{target.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------- Note

export const NotesWidget: React.FC = () => {
  const [note, setNote] = useWidgetSetting('note', '');
  const [draft, setDraft] = useState(note);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <Card title="Note" right={draft !== note ? <span className="text-[10.5px] text-amber-600">saving…</span> : null}>
      <textarea
        value={draft}
        onChange={(e) => {
          const v = e.target.value.slice(0, 2000);
          setDraft(v);
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => setNote(v), 600);
        }}
        placeholder="Tap to write a note…"
        className="w-full h-full min-h-[80px] bg-transparent resize-none outline-none text-[15px] leading-snug text-amber-50 placeholder-amber-700"
      />
    </Card>
  );
};

// ---------------------------------------------------------------------------- Audio

export const SpectrumWidget: React.FC<{ state: JarvisAudioState; isListening: boolean }> = ({ state, isListening }) => (
  <Card
    title="Audio"
    right={
      <span className="text-[10.5px] text-amber-500">
        {state === 'speaking' ? 'Jarvis speaking' : isListening ? 'Listening' : 'Idle'}
      </span>
    }
  >
    <AudioSpectrumMeter bars={36} className="w-full h-full min-h-[50px]" />
  </Card>
);
