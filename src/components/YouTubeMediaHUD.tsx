import React, { useState, useEffect } from 'react';
import {
  Music,
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Radio,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  YouTubePlaybackState,
  subscribeYouTubeState,
  togglePlayPause,
  stopVideo,
  setVolume,
  toggleMute,
} from '../services/youtubeController';

export const YouTubeMediaHUD: React.FC = () => {
  const [ytState, setYtState] = useState<YouTubePlaybackState>({
    isReady: false,
    isPlaying: false,
    isPaused: false,
    videoId: null,
    title: null,
    volume: 100,
    isMuted: false,
    isDucked: false,
  });
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeYouTubeState((state) => {
      setYtState(state);
      // Auto-expand when a new song starts playing
      if (state.isPlaying && !ytState.isPlaying) {
        setIsMinimized(false);
      }
    });
    return unsubscribe;
  }, [ytState.isPlaying]);

  // Only render if a video has been loaded or is currently playing/paused
  if (!ytState.videoId && !ytState.isPlaying && !ytState.isPaused) {
    return null;
  }

  if (isMinimized) {
    return (
      <div className="fixed top-16 right-4 sm:right-6 z-40 animate-in fade-in duration-200">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-full border border-cyan-500/60 bg-black/85 backdrop-blur-md shadow-[0_0_15px_rgba(0,240,255,0.3)] text-cyan-300 hover:border-cyan-400 transition-all text-xs font-orbitron"
          title="Expand YouTube Audio Player"
        >
          <Music className={`w-3.5 h-3.5 text-cyan-400 ${ytState.isPlaying ? 'animate-bounce' : ''}`} />
          <span className="text-[10px] tracking-wider truncate max-w-[100px]">
            {ytState.isPlaying ? 'PLAYING' : 'PAUSED'}
          </span>
          <ChevronDown className="w-3 h-3 text-cyan-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-16 right-3 sm:right-6 z-40 max-w-[320px] sm:max-w-sm w-full animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-auto">
      <div className="relative rounded-xl border border-cyan-500/60 bg-black/90 backdrop-blur-xl p-3.5 shadow-[0_0_25px_rgba(0,240,255,0.22)] font-mono-tech space-y-2.5">
        {/* Sci-Fi Corner Accents */}
        <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-cyan-400" />
        <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-cyan-400" />

        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-cyan-950 pb-2">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-cyan-950/60 border border-cyan-500/50 flex items-center justify-center">
              <Radio className={`w-3.5 h-3.5 text-cyan-400 ${ytState.isPlaying ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="font-orbitron text-[10px] font-bold text-cyan-200 tracking-wider flex items-center space-x-1.5">
                <span>AUDIO STREAM // YT</span>
                {ytState.isDucked && (
                  <span className="text-[8px] px-1 py-0.2 rounded bg-amber-950/80 border border-amber-600/70 text-amber-300 animate-pulse">
                    DUCKED
                  </span>
                )}
              </div>
              <div className="text-[8px] text-cyan-500/80">ACOUSTIC SUB-SYSTEM ACTIVE</div>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            {ytState.videoId && (
              <a
                href={`https://www.youtube.com/watch?v=${ytState.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded text-cyan-500 hover:text-cyan-200 hover:bg-cyan-950/40 transition-colors"
                title="Open Video in YouTube"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 rounded text-cyan-500 hover:text-cyan-200 hover:bg-cyan-950/40 transition-colors"
              title="Minimize Player"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Track Title & Video ID */}
        <div className="space-y-0.5">
          <div className="text-xs font-orbitron text-white truncate max-w-[270px]">
            {ytState.title || (ytState.videoId ? `Track ID: ${ytState.videoId}` : 'Acoustic Stream')}
          </div>
          <div className="text-[9px] text-cyan-400/70 flex items-center justify-between">
            <span>ID: {ytState.videoId || 'UNKNOWN'}</span>
            <span className={ytState.isPlaying ? 'text-emerald-400' : 'text-amber-400'}>
              {ytState.isPlaying ? '● PLAYING' : ytState.isPaused ? '❚❚ PAUSED' : 'STANDBY'}
            </span>
          </div>
        </div>

        {/* Playback & Volume Control Toolbar */}
        <div className="flex items-center justify-between pt-1">
          {/* Controls: Play/Pause, Stop */}
          <div className="flex items-center space-x-2">
            <button
              onClick={togglePlayPause}
              className={`p-2 rounded-lg border transition-all ${
                ytState.isPlaying
                  ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                  : 'border-cyan-800 bg-black/60 text-cyan-400 hover:border-cyan-500'
              }`}
              title={ytState.isPlaying ? 'Pause' : 'Play'}
            >
              {ytState.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={stopVideo}
              className="p-2 rounded-lg border border-red-500/40 bg-red-950/20 text-red-300 hover:bg-red-900/40 hover:border-red-400 transition-colors"
              title="Stop Track"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Volume Slider & Mute */}
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleMute}
              className="p-1.5 text-cyan-400 hover:text-cyan-200 transition-colors"
              title={ytState.isMuted ? 'Unmute' : 'Mute'}
            >
              {ytState.isMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-cyan-300" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={ytState.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 sm:w-20 accent-cyan-400 cursor-pointer h-1.5 bg-cyan-950 rounded-lg appearance-none"
              title={`Volume: ${ytState.volume}%`}
            />
            <span className="text-[9px] text-cyan-400 w-6 text-right font-mono-tech">
              {ytState.volume}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
