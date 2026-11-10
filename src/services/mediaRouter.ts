// One place that decides where a music directive goes: YouTube (the embedded player) or the
// radio / stream player. Only one plays at a time.
import type { Directive } from './directives';
import {
  YouTubePlaybackState,
  getYouTubeState,
  handleJarvisResponse,
  nextTrack,
  pauseVideo,
  playVideo,
  previousTrack,
  setVolume as setYouTubeVolume,
  stopVideo,
  subscribeYouTubeState,
  toggleMute as toggleYouTubeMute,
  togglePlayPause as toggleYouTube,
} from './youtubeController';
import * as stream from './streamPlayer';

/** Run a music directive. Returns false if it isn't one (the caller handles it). */
export function applyMediaDirective(d: Directive | null, raw: string): boolean {
  if (!d) return false;
  switch (d.type) {
    case 'play-radio':
      stopVideo();
      void stream.playRadio(d.query);
      return true;
    case 'play-stream':
      stopVideo();
      void stream.playStream(d.url, d.title);
      return true;
    case 'youtube-video':
    case 'youtube-playlist':
      stream.stop();
      handleJarvisResponse(raw);
      return true;
    case 'youtube-control': {
      if (stream.isActive()) {
        if (d.action === 'pause') stream.pause();
        else if (d.action === 'resume') stream.resume();
        else if (d.action === 'stop') stream.stop();
        else if (d.action === 'next') void stream.next();
        else void stream.previous();
        return true;
      }
      if (d.action === 'pause') pauseVideo();
      else if (d.action === 'resume') playVideo();
      else if (d.action === 'stop') stopVideo();
      else if (d.action === 'next') nextTrack();
      else previousTrack();
      return true;
    }
    case 'set-volume':
      if (stream.isActive()) stream.setVolume(d.volume);
      else setYouTubeVolume(d.volume);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------- what's playing (for the HUD)


export interface MediaView {
  source: 'youtube' | 'radio' | 'stream';
  playing: boolean;
  paused: boolean;
  loading: boolean;
  title: string;
  /** Station country / genre, playlist position, ... */
  subtitle: string;
  volume: number;
  muted: boolean;
  ducked: boolean;
  canNext: boolean;
  canPrev: boolean;
  /** Open it elsewhere (YouTube page / station website) */
  externalUrl: string;
  error: string;
}

function youtubeView(yt: YouTubePlaybackState): MediaView | null {
  if (!yt.videoId && !yt.playlistId && !yt.isPlaying && !yt.isPaused) return null;
  const title = yt.title && !/^(Track|Playlist): /.test(yt.title) ? yt.title : yt.playlistId ? 'YouTube playlist' : 'YouTube';
  return {
    source: 'youtube',
    playing: yt.isPlaying,
    paused: yt.isPaused,
    loading: false,
    title,
    subtitle: yt.playlistId && typeof yt.playlistIndex === 'number' ? `YouTube · track ${yt.playlistIndex + 1}` : 'YouTube',
    volume: yt.volume,
    muted: yt.isMuted,
    ducked: yt.isDucked,
    canNext: Boolean(yt.playlistId),
    canPrev: Boolean(yt.playlistId),
    externalUrl: yt.playlistId ? `https://www.youtube.com/playlist?list=${yt.playlistId}` : yt.videoId ? `https://www.youtube.com/watch?v=${yt.videoId}` : '',
    error: '',
  };
}

function streamView(s: stream.StreamState): MediaView | null {
  if (!s.source) return null;
  return {
    source: s.source,
    playing: s.playing,
    paused: s.paused,
    loading: s.loading,
    title: s.title,
    subtitle: s.subtitle || (s.source === 'radio' ? 'Internet radio' : 'Audio stream'),
    volume: s.volume,
    muted: s.muted,
    ducked: s.ducked,
    canNext: s.canNext,
    canPrev: s.canNext,
    externalUrl: '',
    error: s.error,
  };
}

/** What's playing now (radio/stream wins if both somehow have state), or null */
export function getMediaView(): MediaView | null {
  return streamView(stream.getStreamState()) ?? youtubeView(getYouTubeState());
}

export function subscribeMedia(listener: (v: MediaView | null) => void): () => void {
  const emit = () => listener(getMediaView());
  const a = subscribeYouTubeState(emit);
  const b = stream.subscribeStream(emit);
  return () => {
    a();
    b();
  };
}

const onStream = () => stream.isActive();
export const media = {
  togglePlayPause: () => (onStream() ? stream.togglePlayPause() : toggleYouTube()),
  stop: () => (onStream() ? stream.stop() : stopVideo()),
  next: () => (onStream() ? void stream.next() : nextTrack()),
  previous: () => (onStream() ? void stream.previous() : previousTrack()),
  setVolume: (v: number) => (onStream() ? stream.setVolume(v) : setYouTubeVolume(v)),
  toggleMute: () => (onStream() ? stream.toggleMute() : toggleYouTubeMute()),
};
