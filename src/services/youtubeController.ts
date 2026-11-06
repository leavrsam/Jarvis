/**
 * J.A.R.V.I.S. Sci-Fi HUD - YouTube Audio Engine & Controller
 * Integrates YouTube IFrame API to play music tracks triggered by n8n Jarvis responses
 * Supports directives like: PLAY_YOUTUBE: <videoId>, PAUSE_YOUTUBE, STOP_YOUTUBE, RESUME_YOUTUBE, SET_VOLUME: <0-100>
 * Includes intelligent vocal ducking when Jarvis is speaking or listening.
 */

export interface YouTubePlaybackState {
  isReady: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  videoId: string | null;
  title: string | null;
  volume: number;
  isMuted: boolean;
  isDucked: boolean;
}

type StateListener = (state: YouTubePlaybackState) => void;

let ytPlayer: YT.Player | null = null;
let currentVideoId: string | null = null;
let currentTitle: string | null = null;
let isPlayerReady = false;
let isPlaying = false;
let isPaused = false;
let userVolume = 100;
let isMuted = false;
let isDucked = false;
const listeners = new Set<StateListener>();

function notifyListeners() {
  const state: YouTubePlaybackState = {
    isReady: isPlayerReady,
    isPlaying,
    isPaused,
    videoId: currentVideoId,
    title: currentTitle,
    volume: userVolume,
    isMuted,
    isDucked,
  };
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (e) {
      console.warn('[YouTubeController] Listener error:', e);
    }
  });
}

function handleStateChange(event: { data: number }) {
  if (typeof window === 'undefined' || !window.YT) return;
  const PlayerState = window.YT.PlayerState;

  if (event.data === PlayerState.PLAYING) {
    isPlaying = true;
    isPaused = false;
    try {
      const data = ytPlayer?.getVideoData();
      if (data?.title) {
        currentTitle = data.title;
      }
    } catch {}
  } else if (event.data === PlayerState.PAUSED) {
    isPlaying = false;
    isPaused = true;
  } else if (event.data === PlayerState.ENDED) {
    isPlaying = false;
    isPaused = false;
  } else if (event.data === PlayerState.BUFFERING) {
    // Buffering
  }
  notifyListeners();
}

/**
 * Initializes the YouTube IFrame player on the hidden target element
 */
export function initYouTubePlayer() {
  if (typeof window === 'undefined') return;

  const createPlayerInstance = () => {
    if (!window.YT || !window.YT.Player) return;
    if (ytPlayer) return;

    try {
      ytPlayer = new window.YT.Player('jarvis-youtube-player', {
        height: '0',
        width: '0',
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            isPlayerReady = true;
            try {
              userVolume = event.target.getVolume() || 100;
              isMuted = event.target.isMuted() || false;
            } catch {}
            notifyListeners();
          },
          onStateChange: handleStateChange,
          onError: (err) => {
            console.warn('[YouTubeController] Player error:', err);
          },
        },
      });
    } catch (e) {
      console.warn('[YouTubeController] Error instantiating YT.Player:', e);
    }
  };

  // If YT API is already loaded
  if (window.YT && window.YT.Player) {
    createPlayerInstance();
  } else {
    // Standard YouTube IFrame API ready callback
    const prevOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevOnReady?.();
      createPlayerInstance();
    };
  }
}

// Auto-initialize if DOM is ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initYouTubePlayer();
  } else {
    window.addEventListener('DOMContentLoaded', initYouTubePlayer);
  }
}

/**
 * Primary webhook handler requested for J.A.R.V.I.S.
 * Scans reply text for PLAY_YOUTUBE directives, starts playback,
 * and strips directives so vocal TTS does not read them aloud.
 */
export function handleJarvisResponse(text: string): string {
  if (!text) return text;

  // 1. Check if Jarvis included the playback directive: PLAY_YOUTUBE: <videoId>
  const match = text.match(/PLAY_YOUTUBE:\s*([a-zA-Z0-9_-]{11})/i);
  if (match) {
    const videoId = match[1];
    currentVideoId = videoId;
    currentTitle = `Track: ${videoId}`;

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      try {
        ytPlayer.loadVideoById(videoId);
        ytPlayer.playVideo();
        isPlaying = true;
        isPaused = false;
        notifyListeners();
      } catch (err) {
        console.warn('[YouTubeController] Failed to play video:', err);
      }
    } else {
      // In case player is still initializing, retry as soon as ready
      const checkReadyInterval = setInterval(() => {
        if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
          clearInterval(checkReadyInterval);
          try {
            ytPlayer.loadVideoById(videoId);
            ytPlayer.playVideo();
            isPlaying = true;
            isPaused = false;
            notifyListeners();
          } catch {}
        }
      }, 250);
      setTimeout(() => clearInterval(checkReadyInterval), 8000);
    }
  }

  // 2. Extra directives: PAUSE_YOUTUBE, STOP_YOUTUBE, RESUME_YOUTUBE, SET_VOLUME:<0-100>
  if (/\bPAUSE_YOUTUBE\b/i.test(text)) {
    pauseVideo();
  } else if (/\bSTOP_YOUTUBE\b/i.test(text)) {
    stopVideo();
  } else if (/\bRESUME_YOUTUBE\b/i.test(text)) {
    playVideo();
  }

  const volMatch = text.match(/SET_VOLUME:\s*(\d+)/i);
  if (volMatch) {
    const vol = Math.min(100, Math.max(0, parseInt(volMatch[1], 10)));
    setVolume(vol);
  }

  // 3. Strip the directive tag so Edge-TTS / Gemini TTS doesn't speak "PLAY_YOUTUBE..." aloud
  const cleanSpokenText = text
    .replace(/PLAY_YOUTUBE:\s*[a-zA-Z0-9_-]{11}/gi, '')
    .replace(/\b(?:PAUSE_YOUTUBE|STOP_YOUTUBE|RESUME_YOUTUBE|SET_VOLUME:\s*\d+)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleanSpokenText;
}

/**
 * Playback controls
 */
export function playVideo() {
  if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
    try {
      ytPlayer.playVideo();
      isPlaying = true;
      isPaused = false;
      notifyListeners();
    } catch {}
  }
}

export function pauseVideo() {
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    try {
      ytPlayer.pauseVideo();
      isPlaying = false;
      isPaused = true;
      notifyListeners();
    } catch {}
  }
}

export function stopVideo() {
  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    try {
      ytPlayer.stopVideo();
      isPlaying = false;
      isPaused = false;
      currentVideoId = null;
      currentTitle = null;
      notifyListeners();
    } catch {}
  }
}

export function togglePlayPause() {
  if (isPlaying) {
    pauseVideo();
  } else {
    playVideo();
  }
}

export function setVolume(volume: number) {
  userVolume = Math.min(100, Math.max(0, volume));
  if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
    try {
      if (!isDucked) {
        ytPlayer.setVolume(userVolume);
      }
    } catch {}
  }
  notifyListeners();
}

export function toggleMute() {
  if (ytPlayer && typeof ytPlayer.mute === 'function' && typeof ytPlayer.unMute === 'function') {
    try {
      if (isMuted) {
        ytPlayer.unMute();
        isMuted = false;
      } else {
        ytPlayer.mute();
        isMuted = true;
      }
      notifyListeners();
    } catch {}
  }
}

/**
 * Intelligent Audio Ducking:
 * Lowers music volume to ~20% while Jarvis is vocalizing or listening for commands,
 * then smoothly restores it back to the original level.
 */
export function duckVolume(targetPercent = 20) {
  if (!isPlaying || isDucked) return;
  isDucked = true;
  if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
    try {
      const duckedLevel = Math.round((userVolume * targetPercent) / 100);
      ytPlayer.setVolume(duckedLevel);
    } catch {}
  }
  notifyListeners();
}

export function restoreVolume() {
  if (!isDucked) return;
  isDucked = false;
  if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
    try {
      ytPlayer.setVolume(userVolume);
    } catch {}
  }
  notifyListeners();
}

/**
 * Subscribe to YouTube audio playback state changes
 */
export function subscribeYouTubeState(listener: StateListener): () => void {
  listeners.add(listener);
  // Send initial state immediately
  listener({
    isReady: isPlayerReady,
    isPlaying,
    isPaused,
    videoId: currentVideoId,
    title: currentTitle,
    volume: userVolume,
    isMuted,
    isDucked,
  });

  return () => {
    listeners.delete(listener);
  };
}

export function getYouTubeState(): YouTubePlaybackState {
  return {
    isReady: isPlayerReady,
    isPlaying,
    isPaused,
    videoId: currentVideoId,
    title: currentTitle,
    volume: userVolume,
    isMuted,
    isDucked,
  };
}
