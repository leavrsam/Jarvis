// Floating music controls on phones / tablets: YouTube, internet radio or an audio stream.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, ListMusic, Loader2, Music, Pause, Play, Radio, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import { MediaView, media, subscribeMedia } from '../services/mediaRouter';

const LABEL: Record<MediaView['source'], string> = {
  youtube: 'AUDIO STREAM // YT',
  radio: 'RADIO // LIVE',
  stream: 'AUDIO STREAM',
};

export const YouTubeMediaHUD: React.FC = () => {
  const [view, setView] = useState<MediaView | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const wasPlaying = useRef(false);

  useEffect(
    () =>
      subscribeMedia((v) => {
        setView(v);
        // Auto-expand when something new starts playing
        if (v?.playing && !wasPlaying.current) setIsMinimized(false);
        wasPlaying.current = Boolean(v?.playing);
      }),
    []
  );

  if (!view) return null;
  const SourceIcon = view.source === 'youtube' ? (view.canNext ? ListMusic : Music) : Radio;
  const status = view.loading ? 'CONNECTING…' : view.playing ? '● PLAYING' : view.paused ? '❚❚ PAUSED' : 'STANDBY';

  if (isMinimized) {
    return (
      <div className="fixed top-16 right-4 sm:right-6 z-40 animate-in fade-in duration-200">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-full border border-amber-500/60 bg-black/85 backdrop-blur-md shadow-[0_0_15px_rgba(245,158,11,0.3)] text-amber-300 hover:border-amber-400 transition-all text-xs font-orbitron"
          title="Expand music controls"
        >
          <SourceIcon className={`w-3.5 h-3.5 text-amber-400 ${view.playing ? 'animate-bounce' : ''}`} />
          <span className="text-[10px] tracking-wider truncate max-w-[120px]">{view.playing ? 'PLAYING' : view.loading ? 'CONNECTING' : 'PAUSED'}</span>
          <ChevronDown className="w-3 h-3 text-amber-400" />
        </button>
      </div>
    );
  }

  const btn = 'p-1.5 rounded-lg border border-amber-800 bg-black/60 text-amber-400 hover:border-amber-500 hover:text-amber-200 transition-colors';
  return (
    <div className="fixed top-16 right-3 sm:right-6 z-40 max-w-[320px] sm:max-w-sm w-full animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-auto">
      <div className="relative rounded-xl border border-amber-500/60 bg-black/90 backdrop-blur-xl p-3.5 shadow-[0_0_25px_rgba(245,158,11,0.22)] font-mono-tech space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-950 pb-2">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-amber-950/60 border border-amber-500/50 flex items-center justify-center">
              {view.loading ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              ) : (
                <SourceIcon className={`w-3.5 h-3.5 text-amber-400 ${view.playing ? 'animate-pulse' : ''}`} />
              )}
            </div>
            <div>
              <div className="font-orbitron text-[10px] font-bold text-amber-200 tracking-wider flex items-center space-x-1.5">
                <span>{LABEL[view.source]}</span>
                {view.ducked && (
                  <span className="text-[8px] px-1 py-0.2 rounded bg-amber-950/80 border border-amber-600/70 text-amber-300 animate-pulse">DUCKED</span>
                )}
              </div>
              <div className="text-[8px] text-amber-500/80">
                {view.source === 'youtube' ? 'ACOUSTIC SUB-SYSTEM ACTIVE' : 'KEEPS PLAYING WITH THE SCREEN OFF'}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            {view.externalUrl && (
              <a
                href={view.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded text-amber-500 hover:text-amber-200 hover:bg-amber-950/40 transition-colors"
                title="Open in YouTube"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 rounded text-amber-500 hover:text-amber-200 hover:bg-amber-950/40 transition-colors"
              title="Minimize"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-0.5">
          <div className="text-xs font-orbitron text-white truncate max-w-[270px]">{view.title}</div>
          <div className="text-[9px] text-amber-400/70 flex items-center justify-between">
            <span className="truncate max-w-[170px]">{view.subtitle}</span>
            <span className={view.playing ? 'text-emerald-400 shrink-0 ml-1' : 'text-amber-400 shrink-0 ml-1'}>{status}</span>
          </div>
          {view.error && <div className="text-[10px] text-red-300 font-sans">{view.error}</div>}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center space-x-1.5">
            {view.canPrev && (
              <button onClick={media.previous} className={btn} title={view.source === 'radio' ? 'Previous station' : 'Previous track'}>
                <SkipBack className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={media.togglePlayPause}
              className={`p-2 rounded-lg border transition-all ${
                view.playing
                  ? 'border-amber-400 bg-amber-950/70 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.4)]'
                  : 'border-amber-800 bg-black/60 text-amber-400 hover:border-amber-500'
              }`}
              title={view.playing ? 'Pause' : 'Play'}
            >
              {view.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            {view.canNext && (
              <button onClick={media.next} className={btn} title={view.source === 'radio' ? 'Next station' : 'Next track'}>
                <SkipForward className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={media.stop}
              className="p-2 rounded-lg border border-red-500/40 bg-red-950/20 text-red-300 hover:bg-red-900/40 hover:border-red-400 transition-colors"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button onClick={media.toggleMute} className="p-1.5 text-amber-400 hover:text-amber-200 transition-colors" title={view.muted ? 'Unmute' : 'Mute'}>
              {view.muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-amber-300" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={view.volume}
              onChange={(e) => media.setVolume(Number(e.target.value))}
              className="w-16 sm:w-20 accent-cyan-400 cursor-pointer h-1.5 bg-amber-950 rounded-lg appearance-none"
              title={`Volume: ${view.volume}%`}
            />
            <span className="text-[9px] text-amber-400 w-6 text-right font-mono-tech">{view.volume}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
