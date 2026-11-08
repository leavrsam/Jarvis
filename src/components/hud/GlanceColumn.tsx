// Left column of the wide (kiosk / desktop) HUD: things worth seeing at a glance.
// Clock and greeting, local weather, what's playing, and how Jarvis is doing.
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
} from 'lucide-react';
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

function greeting(hour: number) {
  if (hour < 3) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------- Clock

const ClockCard: React.FC<{ name?: string }> = ({ name }) => {
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

const WeatherCard: React.FC = () => {
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
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'unavailable');
      }
    };
    void load();
    const t = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
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

// ---------------------------------------------------------------------------- Now playing

const NowPlayingCard: React.FC = () => {
  const [yt, setYt] = useState<YouTubePlaybackState | null>(null);
  useEffect(() => subscribeYouTubeState(setYt), []);
  if (!yt || (!yt.videoId && !yt.playlistId && !yt.isPlaying && !yt.isPaused)) return null;
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

interface SystemCardProps {
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

const SystemCard: React.FC<SystemCardProps> = (p) => {
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

// ---------------------------------------------------------------------------- Column

export interface GlanceColumnProps extends SystemCardProps {
  ownerName?: string;
}

export const GlanceColumn: React.FC<GlanceColumnProps> = ({ ownerName, ...system }) => (
  <aside className="absolute z-20 top-[72px] bottom-6 left-6 w-[330px] hidden lg:flex flex-col gap-4 overflow-y-auto hud-scroll pb-1">
    <ClockCard name={ownerName} />
    <WeatherCard />
    <NowPlayingCard />
    <div className="flex-1" />
    <SystemCard {...system} />
  </aside>
);
