// The HUD "screen": shows what Jarvis puts up with SHOW_IMAGE / SHOW_VIDEO / SHOW_CAMERA.
// On a wide (kiosk) display it takes the left of the HUD while the reactor moves to the right
// and the subtitles stay along the bottom.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyScreenDirective, clearScreen, SCREEN_IDLE_MS, ScreenContent, subscribeScreen } from '../services/screenController';
import { subscribeDuck } from '../services/youtubeController';
import { notifyAuthRequired } from '../services/auth';
import { cameraErrorText, readCameraError } from '../services/cameraErrors';

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
        {content.kind === 'camera' &&
          (content.cameras && (content.cameras.length > 1 || content.cameras[0] === 'all') ? (
            <CameraGrid cameras={content.cameras} />
          ) : (
            <CameraView camera={content.camera} />
          ))}
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

const LoadError: React.FC<{ what: string; text?: string }> = ({ what, text }) => (
  <div className="absolute inset-0 flex items-center justify-center">
    <span className="px-3 py-2 rounded border border-amber-700/60 bg-black/70 text-xs text-amber-300 font-mono-tech">
      {text || `Couldn't load that ${what}.`}
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

const CAMERA_REFRESH_GRID_MS = 60_000;

interface GridImage {
  key: string;
  camera: string;
  caption: string;
  src: string | null;
  error: string;
}

/** Grid columns for n tiles: 1, 2, 2x2, 3x2, 3x3 */
const gridCols = (n: number) => (n <= 1 ? 'grid-cols-1' : n <= 4 ? 'grid-cols-2' : 'grid-cols-3');

/**
 * Several cameras at once: "all" (every snapshot n8n returns for camera=all) or a list of names
 * (each fetched separately). Refreshes every minute; tap a tile to show just that camera.
 */
const CameraGrid: React.FC<{ cameras: string[] }> = ({ cameras }) => {
  const all = cameras.length === 1 && cameras[0] === 'all';
  const [tiles, setTiles] = useState<GridImage[]>(() => (all ? [] : cameras.map((c) => ({ key: c, camera: c, caption: '', src: null, error: '' }))));
  const [allError, setAllError] = useState('');
  const [loading, setLoading] = useState(false);
  const restartIdle = useIdleClose();
  const listKey = cameras.join('|');

  const fetchMulti = useCallback(async (name: string, signal: AbortSignal) => {
    const res = await fetch(`/api/camera?camera=${encodeURIComponent(name)}&multi=1`, { cache: 'no-store', signal });
    if (res.status === 401) {
      notifyAuthRequired();
      throw new Error('auth');
    }
    if (!res.ok) {
      const { code, detail } = await readCameraError(res);
      throw Object.assign(new Error(code), { text: cameraErrorText(name, code, detail) });
    }
    const data = await res.json();
    return (Array.isArray(data.images) ? data.images : []) as { camera: string; caption: string; src: string }[];
  }, []);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        if (all) {
          try {
            const images = await fetchMulti('all', signal);
            if (signal.aborted) return;
            setTiles(images.map((img, i) => ({ key: `${img.camera || 'camera'}-${i}`, camera: img.camera || `Camera ${i + 1}`, caption: img.caption, src: img.src, error: '' })));
            setAllError(images.length ? '' : 'n8n answered with no camera images.');
          } catch (err) {
            if (!signal.aborted) setAllError((err as { text?: string }).text || "Couldn't load the cameras.");
          }
          return;
        }
        const results = await Promise.all(
          cameras.map(async (name) => {
            try {
              const [first] = await fetchMulti(name, signal);
              return { key: name, camera: name, caption: first?.caption || '', src: first?.src || null, error: first ? '' : 'No image.' };
            } catch (err) {
              return { key: name, camera: name, caption: '', src: null, error: (err as { text?: string }).text || "Couldn't load." };
            }
          })
        );
        if (!signal.aborted) setTiles(results);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, listKey, fetchMulti]
  );

  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const t = setInterval(() => void load(controller.signal), CAMERA_REFRESH_GRID_MS);
    return () => {
      clearInterval(t);
      controller.abort();
    };
  }, [load, reload]);

  return (
    <>
      <TopBar
        label={all ? 'CAMERAS · ALL' : `CAMERAS · ${cameras.length}`}
        refreshing={loading}
        onRefresh={() => {
          restartIdle();
          setReload((n) => n + 1);
        }}
      />
      {all && allError && !tiles.length ? (
        <LoadError what="cameras" text={allError} />
      ) : !tiles.length ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-500 font-mono-tech">Connecting to cameras…</div>
      ) : (
        <div className={`absolute inset-x-2 bottom-2 top-12 grid ${gridCols(tiles.length)} auto-rows-fr gap-2`}>
          {tiles.map((t) => (
            <button
              key={t.key}
              onClick={() => t.camera && t.src && applyScreenDirective({ type: 'show-camera', camera: t.camera })}
              className="relative rounded-lg overflow-hidden border border-amber-900/60 bg-black min-h-0 text-left group"
              title={t.src ? `Show ${t.camera} on its own` : undefined}
            >
              {t.src ? (
                <img src={t.src} alt={`${t.camera} camera`} className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-[12px] text-amber-400/90 font-mono-tech">
                  {t.error || 'Connecting…'}
                </div>
              )}
              <div className="absolute top-0 inset-x-0 flex items-center gap-2 px-2 py-1 bg-gradient-to-b from-black/80 to-transparent">
                <span className="font-orbitron text-[10px] tracking-[0.18em] text-amber-200 uppercase truncate">{t.camera}</span>
                {t.caption && (
                  <span className="px-1.5 rounded border border-amber-600/60 bg-black/60 text-[10px] font-mono-tech text-amber-200 whitespace-nowrap">{t.caption}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
};

const CameraView: React.FC<{ camera: string }> = ({ camera }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState('');
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
      if (!res.ok || !type.startsWith('image/')) {
        const { code, detail } = await readCameraError(res);
        setErrorText(cameraErrorText(camera, code, detail));
        throw new Error(`HTTP ${res.status} ${code}`);
      }
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
      srcRef.current = url;
      setSrc(url);
      setCaption(res.headers.get('x-image-source') || '');
      setFailed(false);
      setErrorText('');
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
      {failed && <LoadError what="camera image" text={errorText} />}
      {!src && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-500 font-mono-tech">
          Connecting to {camera}…
        </div>
      )}
    </>
  );
};
