// The HUD "screen": shows what Jarvis puts up with SHOW_IMAGE / SHOW_VIDEO / SHOW_CAMERA.
// On a wide (kiosk) display it takes the left of the HUD while the reactor moves to the right
// and the subtitles stay along the bottom.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { clearScreen, SCREEN_IDLE_MS, ScreenContent, subscribeScreen } from '../services/screenController';
import { subscribeDuck } from '../services/youtubeController';
import { notifyAuthRequired } from '../services/auth';

const CAMERA_REFRESH_MS = 60_000;

export const ScreenPanel: React.FC = () => {
  const [content, setContent] = useState<ScreenContent | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(
    () =>
      subscribeScreen((s) => {
        setContent(s.content);
        setVersion(s.version);
      }),
    []
  );

  if (!content) return null;
  return (
    <section
      aria-label="Jarvis screen"
      className="absolute z-[25] left-3 right-3 top-16 h-[42vh] lg:h-auto lg:left-[372px] lg:right-[482px] lg:top-[72px] lg:bottom-[230px] pointer-events-auto"
    >
      <div key={version} className="relative w-full h-full rounded-xl border border-amber-500/50 bg-black/80 backdrop-blur-md shadow-[0_0_40px_rgba(245,158,11,0.18)] overflow-hidden animate-in fade-in duration-700">
        <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-400 z-10" />
        <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-400 z-10" />
        <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-400 z-10" />
        <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-400 z-10" />
        {content.kind === 'image' && <ImageView url={content.url} />}
        {content.kind === 'image-search' && <ImageSearchView query={content.query} />}
        {content.kind === 'video' && <VideoView url={content.url} />}
        {content.kind === 'camera' && <CameraView camera={content.camera} />}
      </div>
    </section>
  );
};

/** Close the screen after SCREEN_IDLE_MS; `restart()` starts the countdown again */
function useIdleClose(active = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => clearScreen(), SCREEN_IDLE_MS);
  }, []);
  useEffect(() => {
    if (active) restart();
    else if (timer.current) clearTimeout(timer.current);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, restart]);
  return restart;
}

const TopBar: React.FC<{ label: string; caption?: string; onRefresh?: () => void; refreshing?: boolean }> = ({
  label,
  caption,
  onRefresh,
  refreshing,
}) => (
  <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/85 to-transparent">
    <span className="font-orbitron text-[10px] tracking-[0.2em] text-amber-300 truncate">{label}</span>
    {caption && (
      <span className="px-1.5 py-0.5 rounded border border-amber-600/60 bg-black/60 text-[10px] font-mono-tech text-amber-200 whitespace-nowrap">
        {/^live$/i.test(caption) && <span className="inline-block w-1.5 h-1.5 mr-1 rounded-full bg-red-500 animate-pulse align-middle" />}
        {caption}
      </span>
    )}
    <span className="flex-1" />
    {onRefresh && (
      <button
        onClick={onRefresh}
        aria-label="Refresh"
        className="p-1.5 rounded border border-amber-700/70 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
        disabled={refreshing}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
    )}
    <button
      onClick={() => clearScreen()}
      aria-label="Close screen"
      className="p-1.5 rounded border border-amber-700/70 text-amber-300 hover:bg-amber-900/40"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);

const LoadError: React.FC<{ what: string }> = ({ what }) => (
  <div className="absolute inset-0 flex items-center justify-center">
    <span className="px-3 py-2 rounded border border-amber-700/60 bg-black/70 text-xs text-amber-300 font-mono-tech">
      Couldn't load that {what}.
    </span>
  </div>
);

type ImageCredit = { title: string; creator: string; license: string; source: string };

const ImageView: React.FC<{ url: string; label?: string; credit?: ImageCredit }> = ({ url, label = 'IMAGE', credit }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useIdleClose();
  return (
    <>
      <TopBar label={label} />
      {!failed && (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full h-full object-contain transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {failed && <LoadError what="image" />}
      {credit && loaded && !failed && (
        <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 bg-gradient-to-t from-black/85 to-transparent text-[10px] font-mono-tech text-amber-300/80 truncate">
          {[credit.title, credit.creator && `by ${credit.creator}`, credit.license, credit.source].filter(Boolean).join(' · ')}
        </div>
      )}
    </>
  );
};

/** SHOW_IMAGE_SEARCH: find a real photo of the query (server side), then show it */
const ImageSearchView: React.FC<{ query: string }> = ({ query }) => {
  const [result, setResult] = useState<(ImageCredit & { url: string }) | null>(null);
  const [status, setStatus] = useState<'searching' | 'found' | 'none'>('searching');
  useIdleClose(status === 'none');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('searching');
    setResult(null);
    fetch(`/api/image-search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) {
          notifyAuthRequired();
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.url === 'string' && data.url.startsWith('https://')) {
          setResult(data);
          setStatus('found');
        } else {
          setStatus('none');
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.warn('[Screen] image search failed:', err);
          setStatus('none');
        }
      });
    return () => controller.abort();
  }, [query]);

  if (status === 'found' && result) return <ImageView url={result.url} label={query.toUpperCase()} credit={result} />;
  return (
    <>
      <TopBar label={query.toUpperCase()} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="px-3 py-2 rounded border border-amber-700/60 bg-black/70 text-xs text-amber-300 font-mono-tech">
          {status === 'searching' ? `Finding a picture of ${query}…` : `Couldn't find a picture of ${query}.`}
        </span>
      </div>
    </>
  );
};

const VideoView: React.FC<{ url: string }> = ({ url }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  // While playing, the screen stays up; once it ends (or fails) the idle countdown starts
  useIdleClose(ended || failed);

  // Muted while Jarvis is talking/listening (the same signal that ducks YouTube)
  useEffect(
    () =>
      subscribeDuck((ducked) => {
        const v = ref.current;
        if (v) v.muted = ducked;
      }),
    []
  );

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.play().catch(() => {
      // Autoplay with sound blocked: start muted instead
      v.muted = true;
      void v.play().catch(() => {});
    });
  }, [url]);

  return (
    <>
      <TopBar label="VIDEO" />
      {!failed && (
        <video
          ref={ref}
          src={url}
          playsInline
          autoPlay
          controls
          preload="auto"
          onEnded={() => setEnded(true)}
          onPlay={() => setEnded(false)}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain bg-black"
        />
      )}
      {failed && <LoadError what="video" />}
    </>
  );
};

const CameraView: React.FC<{ camera: string }> = ({ camera }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const restartIdle = useIdleClose();
  const srcRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`/api/camera?camera=${encodeURIComponent(camera)}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res.status === 401) {
        notifyAuthRequired();
        return;
      }
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
      srcRef.current = url;
      setSrc(url);
      setCaption(res.headers.get('x-image-source') || '');
      setFailed(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn('[Screen] camera load failed:', err);
      setFailed(true);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [camera]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), CAMERA_REFRESH_MS);
    return () => {
      clearInterval(t);
      abortRef.current?.abort();
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    };
  }, [load]);

  return (
    <>
      <TopBar
        label={`CAMERA · ${camera.toUpperCase()}`}
        caption={caption || undefined}
        refreshing={loading}
        onRefresh={() => {
          restartIdle();
          void load();
        }}
      />
      {src && (
        <img
          src={src}
          alt={`${camera} camera`}
          className={`w-full h-full object-contain transition-opacity duration-700 ${failed ? 'opacity-30' : 'opacity-100'}`}
        />
      )}
      {failed && <LoadError what="camera image" />}
      {!src && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-500 font-mono-tech">
          Connecting to {camera}…
        </div>
      )}
    </>
  );
};
