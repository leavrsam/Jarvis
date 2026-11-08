// The HUD's "at a glance" cards: clock and greeting, local weather, calendar, what's playing,
// and how Jarvis is doing. Placed by WidgetBoard (movable on wide screens, stacked on phones).
import React, { useEffect, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LocateFixed,
  Moon,
  Pause,
  Play,
  SkipForward,
  Square,
  Sun,
  Sunrise,
  Sunset,
  Wind,
  Music,
  CalendarDays,
  MapPin,
} from 'lucide-react';
import { notifyAuthRequired } from '../../services/auth';
import { describeWeather, fetchWeather, getLocation, requestPreciseLocation, Weather } from '../../services/weather';
import {
  nextTrack,
  stopVideo,
  subscribeYouTubeState,
  togglePlayPause,
  YouTubePlaybackState,
} from '../../services/youtubeController';
import { AudioSpectrumMeter } from '../AudioSpectrumMeter';
import { builtInStats, hudMetrics } from '../../services/eventLog';
import { getLiveTranscription } from '../../services/micSettings';
import { liveTranscriptionUnavailable } from '../../services/liveTranscriber';
import type { JarvisAudioState } from '../../services/audioEngine';
import type { WakeWordMode } from '../TelemetryHUD';
import type { BatteryStatus } from '../../hooks/useBatteryStatus';

const WEATHER_REFRESH_MS = 15 * 60 * 1000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Run `load` now and then every `intervalMs`, but only while the page is visible: a HUD left
 * open in a background tab (or on another device) makes no calls. When the page comes back
 * into view, refresh at once if the last load is older than the interval.
 * Returns a cleanup function.
 */
export function everyWhileVisible(load: () => void, intervalMs: number): () => void {
  let lastAt = Date.now();
  const run = () => {
    lastAt = Date.now();
    load();
  };
  const tick = () => {
    if (!document.hidden) run();
  };
  const onVisible = () => {
    if (!document.hidden && Date.now() - lastAt >= intervalMs) run();
  };
  load();
  const t = setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function greeting(hour: number) {
  if (hour < 3) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------- Clock

export const ClockCard: React.FC<{ name?: string }> = ({ name }) => {
  const now = useNow(1000);
  const h = now.getHours();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
  const ampm = h < 12 ? 'AM' : 'PM';
  return (
    <div className="hud-panel px-5 pt-4 pb-4">
      <div className="flex items-end gap-2">
        <span className="font-orbitron font-light text-[64px] leading-none tracking-wide text-amber-100 tabular-nums text-glow-amber">
          {time}
        </span>
        <div className="flex flex-col pb-1.5">
          <span className="font-orbitron text-sm text-amber-300/90">{ampm}</span>
          <span className="font-mono-tech text-xs text-amber-500/80 tabular-nums">{String(now.getSeconds()).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="mt-2 text-[15px] text-amber-200/90 font-semibold tracking-wide">
        {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div className="text-[13px] text-amber-500/80">
        {greeting(h)}
        {name ? `, ${name}` : ''}.
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- Weather

function WeatherIcon({ code, isDay = true, className = '' }: { code: number; isDay?: boolean; className?: string }) {
  const props = { className, strokeWidth: 1.5 };
  if (code === 0 || code === 1) return isDay ? <Sun {...props} /> : <Moon {...props} />;
  if (code === 2) return isDay ? <CloudSun {...props} /> : <Cloud {...props} />;
  if (code === 3) return <Cloud {...props} />;
  if (code === 45 || code === 48) return <CloudFog {...props} />;
  if (code >= 51 && code <= 57) return <CloudDrizzle {...props} />;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain {...props} />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow {...props} />;
  if (code >= 95) return <CloudLightning {...props} />;
  return <Cloud {...props} />;
}

const fmtHour = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, '').toLowerCase();
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const WeatherCard: React.FC = () => {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState('');
  const [precise, setPrecise] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loc = await getLocation();
        if (cancelled) return;
        setPrecise(loc.precise);
        const w = await fetchWeather(loc);
        if (!cancelled) {
          setWeather(w);
          setError('');
        }
        failures = 0;
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || 'unavailable');
        // Try again sooner than the next refresh, backing off 1, 2, 4, 8 min. Only one retry
        // is ever pending, so a long outage can't pile up retry loops.
        failures++;
        clearTimeout(retry);
        const delay = Math.min(60_000 * 2 ** (failures - 1), WEATHER_REFRESH_MS);
        if (delay < WEATHER_REFRESH_MS) {
          retry = setTimeout(() => {
            if (!document.hidden) void load();
          }, delay);
        }
      }
    };
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const stop = everyWhileVisible(() => void load(), WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
      clearTimeout(retry);
    };
  }, [reload]);

  const sunEvent = (() => {
    if (!weather?.sunrise || !weather.sunset) return null;
    const now = Date.now();
    if (now < weather.sunrise.getTime()) return { icon: Sunrise, label: `Sunrise ${fmtTime(weather.sunrise)}` };
    if (now < weather.sunset.getTime()) return { icon: Sunset, label: `Sunset ${fmtTime(weather.sunset)}` };
    return null;
  })();

  return (
    <div className="hud-panel px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="hud-label">Weather</span>
        <span className="flex items-center gap-1.5 text-[11px] text-amber-500/80 truncate max-w-[190px]">
          {weather?.place}
          {!precise && (
            <button
              onClick={() =>
                void requestPreciseLocation()
                  .then(() => setReload((n) => n + 1))
                  .catch(() => setError('location not allowed'))
              }
              title="Approximate location (from the network). Use this device's location instead."
              className="text-amber-500 hover:text-amber-200"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>
      {!weather ? (
        <div className="py-5 text-sm text-amber-500/70">{error ? 'Weather unavailable right now.' : 'Checking the sky…'}</div>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-4">
            <WeatherIcon code={weather.code} isDay={weather.isDay} className="w-12 h-12 text-amber-200" />
            <div>
              <div className="font-orbitron font-light text-[40px] leading-none text-amber-100 tabular-nums">
                {weather.tempF}°
              </div>
              <div className="text-[13px] text-amber-300/90">{describeWeather(weather.code)}</div>
            </div>
            <div className="ml-auto text-right text-[12px] leading-5 text-amber-400/90 tabular-nums">
              <div>
                H {weather.highF}° · L {weather.lowF}°
              </div>
              <div>Feels {weather.feelsF}°</div>
              <div className="flex items-center justify-end gap-1">
                <Wind className="w-3 h-3" /> {weather.windMph} mph
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1 border-t border-amber-900/40 pt-3">
            {weather.hours.map((h) => (
              <div key={h.time.getTime()} className="flex flex-col items-center gap-1 text-[11px] text-amber-400/80">
                <span>{fmtHour(h.time)}</span>
                <WeatherIcon code={h.code} className="w-4 h-4 text-amber-300/90" />
                <span className="text-amber-200 tabular-nums">{h.tempF}°</span>
                {h.rainChance >= 20 && <span className="text-[10px] text-cyan-300/80">{h.rainChance}%</span>}
              </div>
            ))}
          </div>
          {sunEvent && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-amber-500/80">
              <sunEvent.icon className="w-3.5 h-3.5" />
              {sunEvent.label}
              {weather.rainChance >= 30 && <span className="ml-auto text-cyan-300/80">{weather.rainChance}% rain today</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------- Calendar

interface CalendarEvent {
  title: string;
  start: string; // ISO, or YYYY-MM-DD for all-day
  end: string | null;
  allDay: boolean;
  location: string;
  calendar: string;
  calendarId: string;
  color: string;
}

interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  selectedInGoogle: boolean;
}

const CALENDAR_REFRESH_MS = 5 * 60 * 1000;
const CALENDAR_LIST_REFRESH_MS = 30 * 60 * 1000;
const CALENDAR_CHOICE_KEY = 'jarvis_hud_calendars';
export const DEFAULT_EVENT_COLOR = '#f59e0b';
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Calendars chosen on this device (null: not chosen yet, use the Google defaults) */
export function readCalendarChoice(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(CALENDAR_CHOICE_KEY) || 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
  } catch {
    return null;
  }
}

function saveCalendarChoice(ids: string[]) {
  try {
    localStorage.setItem(CALENDAR_CHOICE_KEY, JSON.stringify(ids));
  } catch {}
}

function untilText(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
}

const Dot: React.FC<{ color: string; className?: string }> = ({ color, className = '' }) => (
  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${className}`} style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}99` }} />
);

export const CalendarCard: React.FC = () => {
  const now = useNow(30_000);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_configured' | 'error'>('loading');
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [choice, setChoice] = useState<string[] | null>(() => readCalendarChoice());
  const [showPicker, setShowPicker] = useState(false);

  // The calendar list (for the switches and colours)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/calendar?mode=calendars', { cache: 'no-store' });
        if (res.status === 401) return notifyAuthRequired();
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.calendars)) setCalendars(data.calendars);
      } catch {}
    };
    const stop = everyWhileVisible(() => void load(), CALENDAR_LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // Which calendars to show: this device's choice (minus any that no longer exist), else the
  // ones switched on in Google Calendar; before the list arrives, the saved choice or Google's
  const selected: string[] | null = (() => {
    if (calendars) {
      const ids = new Set(calendars.map((c) => c.id));
      if (choice) return choice.filter((id) => ids.has(id));
      return calendars.filter((c) => c.selectedInGoogle).map((c) => c.id);
    }
    return choice;
  })();
  const selectedKey = selected ? selected.join(',') : '*';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (selected && selected.length === 0) {
        setEvents([]);
        setErrors([]);
        setStatus('ok');
        return;
      }
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 2); // today and tomorrow
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      if (selected) params.set('calendars', selected.join(','));
      try {
        const res = await fetch(`/api/calendar?${params}`, { cache: 'no-store' });
        if (res.status === 401) return notifyAuthRequired();
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(data.events)) {
          setEvents(data.events);
          setErrors(Array.isArray(data.calendarErrors) ? data.calendarErrors : []);
          setStatus('ok');
        } else {
          setStatus(data.error === 'not_configured' ? 'not_configured' : 'error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    const stop = everyWhileVisible(() => void load(), CALENDAR_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const toggle = (id: string) => {
    const base = selected ?? [];
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setChoice(next);
    saveCalendarChoice(next);
  };

  const colorById = new Map((calendars || []).map((c) => [c.id, c.color]));
  const colorOf = (e: CalendarEvent) => e.color || colorById.get(e.calendarId) || DEFAULT_EVENT_COLOR;

  const today = localDay(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDay(tomorrowDate);
  const dayOf = (e: CalendarEvent) => (e.allDay ? e.start.slice(0, 10) : localDay(new Date(e.start)));
  const endMs = (e: CalendarEvent) => (e.end ? new Date(e.end).getTime() : new Date(e.start).getTime() + 30 * 60000);

  const list = events || [];
  const allDayToday = list.filter((e) => e.allDay && e.start.slice(0, 10) <= today && (!e.end || e.end.slice(0, 10) > today));
  const timedToday = list.filter((e) => !e.allDay && dayOf(e) === today);
  const current = timedToday.filter((e) => new Date(e.start).getTime() <= now.getTime() && endMs(e) > now.getTime());
  const upcoming = timedToday.filter((e) => new Date(e.start).getTime() > now.getTime());
  const done = timedToday.filter((e) => endMs(e) <= now.getTime()).length;
  const tomorrowEvents = list.filter((e) => dayOf(e) === tomorrow);

  const timeOf = (e: CalendarEvent) => new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nothingSelected = selected !== null && selected.length === 0;

  return (
    <div className="hud-panel px-5 py-4 flex flex-col min-h-[150px] flex-1">
      <div className="flex items-center justify-between">
        <span className="hud-label">Calendar</span>
        {status !== 'not_configured' && (
          <button
            onClick={() => setShowPicker((v) => !v)}
            title="Choose calendars"
            aria-expanded={showPicker}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
              showPicker ? 'border-amber-400/70 text-amber-200 bg-amber-950/50' : 'border-amber-800/60 text-amber-500 hover:text-amber-300'
            }`}
          >
            <span className="flex -space-x-0.5">
              {(calendars || [])
                .filter((c) => selected?.includes(c.id))
                .slice(0, 4)
                .map((c) => (
                  <Dot key={c.id} color={c.color || DEFAULT_EVENT_COLOR} className="ring-1 ring-black" />
                ))}
            </span>
            <CalendarDays className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showPicker && (
        <div className="mt-2.5 rounded-lg border border-amber-900/50 bg-black/40 p-2 max-h-[220px] overflow-y-auto hud-scroll">
          {!calendars ? (
            <div className="px-1 py-1.5 text-[12px] text-amber-500/80">Loading calendars…</div>
          ) : calendars.length === 0 ? (
            <div className="px-1 py-1.5 text-[12px] text-amber-500/80">No calendars found.</div>
          ) : (
            calendars.map((c) => {
              const on = Boolean(selected?.includes(c.id));
              return (
                <label key={c.id} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded hover:bg-amber-900/20 cursor-pointer">
                  <Dot color={c.color || DEFAULT_EVENT_COLOR} />
                  <span className={`flex-1 min-w-0 truncate text-[13px] ${on ? 'text-amber-100' : 'text-amber-600'}`}>
                    {c.name}
                    {c.primary && <span className="ml-1.5 text-[10px] text-amber-600">primary</span>}
                  </span>
                  <input type="checkbox" className="sr-only peer" checked={on} onChange={() => toggle(c.id)} />
                  <span
                    aria-hidden="true"
                    className="relative w-8 h-[18px] rounded-full bg-zinc-700 transition-colors peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-[14px]"
                  />
                </label>
              );
            })
          )}
        </div>
      )}

      {status === 'loading' && <div className="py-4 text-sm text-amber-500/70">Checking your calendar…</div>}
      {status === 'not_configured' && (
        <div className="py-3 text-[12.5px] text-amber-500/80 leading-snug">
          Not connected yet. Add the n8n calendar webhook as <span className="font-mono-tech text-amber-300">JARVIS_CALENDAR_URL</span> in
          Vercel (see README).
        </div>
      )}
      {status === 'error' && <div className="py-4 text-sm text-amber-500/70">Calendar unavailable right now.</div>}

      {status === 'ok' && (
        <div className="mt-2 flex-1 min-h-0 overflow-y-auto hud-scroll space-y-3">
          {nothingSelected && <div className="text-[13px] text-amber-500/80">No calendars selected. Tap the calendar button to choose.</div>}

          {allDayToday.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allDayToday.map((e, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border bg-black/30 text-[11.5px] text-amber-100 truncate max-w-full"
                  style={{ borderColor: `${colorOf(e)}88` }}
                  title={e.calendar || undefined}
                >
                  <Dot color={colorOf(e)} className="!w-1.5 !h-1.5" />
                  {e.title}
                </span>
              ))}
            </div>
          )}

          {current.map((e, i) => (
            <div
              key={`now-${i}`}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: `${colorOf(e)}99`, background: `linear-gradient(90deg, ${colorOf(e)}22, transparent)` }}
            >
              <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-amber-200/90">
                <span className="flex items-center gap-1.5">
                  <Dot color={colorOf(e)} /> Now
                </span>
                {e.end && <span className="normal-case tracking-normal">until {clock(e.end)}</span>}
              </div>
              <div className="text-[15px] text-amber-50 truncate">{e.title}</div>
              {e.location && (
                <div className="flex items-center gap-1 text-[11px] text-amber-300/70 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {e.location}
                </div>
              )}
            </div>
          ))}

          {upcoming.length > 0 ? (
            <div className="space-y-1.5">
              {upcoming.map((e, i) => {
                const startsIn = new Date(e.start).getTime() - now.getTime();
                const soon = i === 0 && startsIn < 3 * 3600_000;
                return (
                  <div key={`${e.start}-${i}`} className="flex items-baseline gap-2.5" title={e.calendar || undefined}>
                    <span className="w-[58px] shrink-0 text-right text-[12px] tabular-nums text-amber-400">{timeOf(e)}</span>
                    <Dot color={colorOf(e)} className="self-center" />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate ${soon ? 'text-[15px] text-amber-50' : 'text-[13.5px] text-amber-100/85'}`}>{e.title}</div>
                      {soon && (
                        <div className="text-[11px] text-amber-500/90 truncate">
                          {untilText(startsIn)}
                          {e.location ? ` · ${e.location}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            current.length === 0 &&
            !nothingSelected && (
              <div className="text-[13.5px] text-amber-300/80">
                {done > 0 ? 'Nothing else today.' : allDayToday.length ? 'No timed events today.' : 'Nothing on the calendar today.'}
              </div>
            )
          )}

          {tomorrowEvents.length > 0 && (
            <div className="pt-2 border-t border-amber-900/40">
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-amber-600/90 mb-1">Tomorrow</div>
              {tomorrowEvents.slice(0, 4).map((e, i) => (
                <div key={`t-${i}`} className="flex items-baseline gap-2.5 text-[12.5px]">
                  <span className="w-[58px] shrink-0 text-right tabular-nums text-amber-600">{e.allDay ? 'All day' : timeOf(e)}</span>
                  <Dot color={colorOf(e)} className="self-center opacity-80" />
                  <span className="truncate text-amber-200/70">{e.title}</span>
                </div>
              ))}
              {tomorrowEvents.length > 4 && <div className="pl-[78px] text-[11px] text-amber-700">+{tomorrowEvents.length - 4} more</div>}
            </div>
          )}

          {errors.length > 0 && <div className="text-[11px] text-red-300/80">Couldn’t load: {errors.join(', ')}</div>}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------- Now playing

/** Hidden when nothing is playing, unless `showIdle` (layout mode shows where it will appear) */
export const NowPlayingCard: React.FC<{ showIdle?: boolean }> = ({ showIdle }) => {
  const [yt, setYt] = useState<YouTubePlaybackState | null>(null);
  useEffect(() => subscribeYouTubeState(setYt), []);
  if (!yt || (!yt.videoId && !yt.playlistId && !yt.isPlaying && !yt.isPaused)) {
    return showIdle ? (
      <div className="hud-panel px-5 py-3.5">
        <span className="hud-label">Now playing</span>
        <p className="mt-1.5 text-[12px] text-amber-500/80">Shows here while music is playing.</p>
      </div>
    ) : null;
  }
  const title = yt.title && !/^(Track|Playlist): /.test(yt.title) ? yt.title : yt.playlistId ? 'YouTube playlist' : 'YouTube';
  return (
    <div className="hud-panel px-5 py-3.5">
      <div className="flex items-center justify-between">
        <span className="hud-label">Now playing</span>
        {yt.isDucked && <span className="text-[10px] text-amber-500/80">volume lowered while Jarvis talks</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg border border-amber-700/50 bg-amber-950/40 flex items-center justify-center shrink-0">
          <Music className={`w-4 h-4 text-amber-300 ${yt.isPlaying ? 'animate-pulse' : ''}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] text-amber-100 truncate">{title}</div>
          <div className="text-[11px] text-amber-500/80">
            {yt.isPlaying ? 'Playing' : 'Paused'}
            {yt.playlistId && typeof yt.playlistIndex === 'number' ? ` · track ${yt.playlistIndex + 1}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={togglePlayPause} className="p-2 rounded-full text-amber-200 hover:bg-amber-900/40" aria-label={yt.isPlaying ? 'Pause' : 'Play'}>
            {yt.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          {yt.playlistId && (
            <button onClick={nextTrack} className="p-2 rounded-full text-amber-300 hover:bg-amber-900/40" aria-label="Next track">
              <SkipForward className="w-4 h-4" />
            </button>
          )}
          <button onClick={stopVideo} className="p-2 rounded-full text-amber-400 hover:bg-amber-900/40" aria-label="Stop">
            <Square className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- System

type Tone = 'good' | 'busy' | 'warn' | 'off';
const DOT: Record<Tone, string> = {
  good: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
  busy: 'bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] animate-pulse',
  warn: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
  off: 'bg-zinc-600',
};

const Row: React.FC<{ tone: Tone; label: string; value: React.ReactNode; onClick?: () => void; title?: string }> = ({
  tone,
  label,
  value,
  onClick,
  title,
}) => {
  const body = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[tone]}`} />
      <span className="text-amber-500/90 w-[78px] shrink-0">{label}</span>
      <span className="text-amber-100/90 truncate text-right flex-1">{value}</span>
    </>
  );
  return onClick ? (
    <button onClick={onClick} title={title} className="w-full flex items-center gap-2.5 py-[5px] text-left hover:bg-amber-900/20 rounded -mx-1 px-1">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-2.5 py-[5px]" title={title}>
      {body}
    </div>
  );
};

const secs = (ms: number) => (ms ? `${(ms / 1000).toFixed(1)} s` : '—');

export interface SystemCardProps {
  audioState: JarvisAudioState;
  isListening: boolean;
  isProcessing: boolean;
  engine: 'builtin' | 'browser';
  wakeWordMode: WakeWordMode;
  isWakeWordActive: boolean;
  onToggleWakeWordMode?: () => void;
  battery: BatteryStatus;
  voiceName: string;
  onOpenVoice?: () => void;
  onOpenVoiceId?: () => void;
}

export const SystemCard: React.FC<SystemCardProps> = (p) => {
  useNow(1000); // refresh the live figures
  const liveOn = p.engine === 'builtin' && getLiveTranscription() && !liveTranscriptionUnavailable();
  const wakeReady = p.engine === 'browser' || builtInStats.modelStatus === 'ready';

  const listening: { tone: Tone; text: string } = p.isListening
    ? { tone: 'busy', text: 'Listening now' }
    : !p.isWakeWordActive
      ? { tone: 'off', text: p.wakeWordMode === 'off' ? 'Wake word off' : 'Wake word paused (on battery)' }
      : wakeReady
        ? { tone: 'good', text: 'Say “Hey Jarvis”' }
        : { tone: 'warn', text: builtInStats.modelStatus === 'error' ? 'Wake word unavailable' : 'Starting…' };

  const wakeLabel = p.wakeWordMode === 'always' ? 'Always on' : p.wakeWordMode === 'charging_only' ? 'When on power' : 'Off';
  const m = hudMetrics;

  return (
    <div className="hud-panel px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="hud-label">System</span>
        <span className="text-[10px] font-mono-tech text-amber-600/80">build {__BUILD_ID__}</span>
      </div>
      <div className="mt-2.5 text-[12.5px]">
        <Row tone={listening.tone} label="Listening" value={listening.text} />
        <Row
          tone={p.isWakeWordActive ? 'good' : 'off'}
          label="Wake word"
          value={wakeLabel}
          onClick={p.onToggleWakeWordMode}
          title="Change when Jarvis listens for “Hey Jarvis”"
        />
        <Row
          tone={p.engine === 'browser' ? 'warn' : liveOn ? 'good' : 'warn'}
          label="Hearing"
          value={
            p.engine === 'browser'
              ? 'Browser speech'
              : liveOn
                ? `Live${m.heardMs ? ` · ${secs(m.heardMs)}` : ''}`
                : `Upload${m.heardMs ? ` · ${secs(m.heardMs)}` : ''}`
          }
          onClick={p.onOpenVoiceId}
          title="Speech-to-text and how long your last command took to become text"
        />
        <Row
          tone={p.isProcessing ? 'busy' : m.brainMs ? 'good' : 'off'}
          label="Thinking"
          value={p.isProcessing ? 'Working…' : m.brainMs ? `n8n · ${secs(m.brainMs)}` : 'n8n'}
          title="Time from your command to n8n's first words"
        />
        <Row
          tone={p.audioState === 'speaking' ? 'busy' : 'good'}
          label="Voice"
          value={`${p.voiceName}${m.voiceMs ? ` · ${secs(m.voiceMs)}` : ''}`}
          onClick={p.onOpenVoice}
          title="Voice model and how long it took to start the last sentence"
        />
        <Row
          tone={m.speaker && !/unverified|unrecognized/i.test(m.speaker) ? 'good' : 'off'}
          label="Voice ID"
          value={m.speaker ? `${m.speaker}${m.speakerScore ? ` · ${Math.round(m.speakerScore * 100)}%` : ''}` : '—'}
          onClick={p.onOpenVoiceId}
        />
        {m.firstAudioMs > 0 && (
          <div className="mt-2 pt-2 border-t border-amber-900/40 flex items-center justify-between text-[11px] text-amber-500/80">
            <span>Last reply started talking after</span>
            <span className="font-orbitron text-amber-200 tabular-nums">{secs(m.firstAudioMs)}</span>
          </div>
        )}
        {!p.battery.charging && p.battery.level < 1 && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-amber-500/80">
            <span>On battery</span>
            <span className="tabular-nums">{Math.round(p.battery.level * 100)}%</span>
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-amber-900/40">
        <AudioSpectrumMeter bars={28} className="w-full h-8 opacity-90" />
      </div>
    </div>
  );
};
