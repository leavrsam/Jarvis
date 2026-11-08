/// <reference types="vite/client" />

declare namespace YT {
  interface PlayerVars {
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    modestbranding?: 0 | 1;
    rel?: 0 | 1;
    loop?: 0 | 1;
    fs?: 0 | 1;
    disablekb?: 0 | 1;
    playsinline?: 0 | 1;
    origin?: string;
    start?: number;
  }

  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: PlayerVars;
    events?: {
      onReady?: (event: { target: Player }) => void;
      onStateChange?: (event: { data: number; target: Player }) => void;
      onError?: (event: { data: number; target: Player }) => void;
    };
  }

  interface Player {
    loadVideoById(videoId: string | { videoId: string; startSeconds?: number }): void;
    cueVideoById(videoId: string | { videoId: string; startSeconds?: number }): void;
    loadPlaylist(
      playlist: string | string[] | { list?: string; listType?: string; index?: number; startSeconds?: number; suggestedQuality?: string },
      index?: number,
      startSeconds?: number,
      suggestedQuality?: string
    ): void;
    cuePlaylist(
      playlist: string | string[] | { list?: string; listType?: string; index?: number; startSeconds?: number; suggestedQuality?: string },
      index?: number,
      startSeconds?: number,
      suggestedQuality?: string
    ): void;
    nextVideo(): void;
    previousVideo(): void;
    playVideoAt(index: number): void;
    getPlaylist(): string[];
    getPlaylistIndex(): number;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getPlayerState(): number;
    getCurrentTime(): number;
    getDuration(): number;
    getVideoData(): {
      video_id: string;
      author: string;
      title: string;
    };
    destroy(): void;
  }

  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

interface Window {
  YT?: {
    Player: new (elementId: string, options: YT.PlayerOptions) => YT.Player;
    PlayerState: typeof YT.PlayerState;
  };
  onYouTubeIframeAPIReady?: () => void;
}

/** Deployed commit (short), or 'dev' */
declare const __BUILD_ID__: string;
