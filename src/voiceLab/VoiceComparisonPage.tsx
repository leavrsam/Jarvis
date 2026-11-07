import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, EyeOff, Loader2, Play, RefreshCw, Star, Square } from 'lucide-react';
import { AutoMatchPanel } from './AutoMatchPanel';
import {
  DEFAULT_TUNING,
  LabMetrics,
  LabPolish,
  NO_MATCH,
  setPolish as applyPolishSettings,
  LabVoice,
  VoiceTuning,
  cellKey,
  loadAllCachedMetrics,
  playCell,
  stopAll,
} from './labClient';

const TEST_LINES = [
  'Good evening, sir. All systems are operational.',
  'It is currently forty-nine degrees with a few clouds and a brisk breeze outside.',
  "I'm afraid that failed to save, sir. <short pause> Shall I try again in a moment?",
  'Your next meeting is at 3:30 PM with the dealer team, about forty minutes from now.',
];

const BLIND_STORAGE_KEY = 'jarvis_voice_lab_blind';
const TUNING_STORAGE_KEY = 'jarvis_voice_lab_tuning';
const POLISH_STORAGE_KEY = 'jarvis_voice_lab_polish';

function loadPolish(): LabPolish {
  // Start from the EQ the live app currently uses (Voice Lab settings), pitch unchanged
  let live = { warmthDb: 2.2, presenceDb: 2.4, intercomWet: 0.08 };
  try {
    live = { ...live, ...JSON.parse(localStorage.getItem('jarvis_voice_tuning') || '{}') };
  } catch {}
  const base: LabPolish = {
    enabled: false,
    warmthDb: live.warmthDb,
    presenceDb: live.presenceDb,
    intercomWet: live.intercomWet,
    match: { ...NO_MATCH },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(POLISH_STORAGE_KEY) || '{}');
    // Older saves kept a single global pitch; it now belongs to the matched voice
    const match = { ...NO_MATCH, ...(saved.match || {}) };
    if (typeof saved.pitchSemitones === 'number' && !saved.match) match.pitchSemitones = saved.pitchSemitones;
    return { ...base, ...saved, match };
  } catch {
    return base;
  }
}

function loadTunings(): Record<string, VoiceTuning> {
  try {
    return JSON.parse(localStorage.getItem(TUNING_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

const EXPRESSIVITY_LABELS: Record<number, string> = {
  [-2]: '-2 very calm',
  [-1]: '-1 calm',
  0: '0 default',
  1: '+1 lively',
  2: '+2 animated',
};

interface BlindState {
  order: string[];
  ratings: Record<string, number>;
  revealed: boolean;
}

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function loadBlindState(): BlindState | null {
  try {
    const raw = localStorage.getItem(BLIND_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BlindState) : null;
  } catch {
    return null;
  }
}

function saveBlindState(state: BlindState | null) {
  try {
    if (state) localStorage.setItem(BLIND_STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(BLIND_STORAGE_KEY);
  } catch {}
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fmtSec = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const fmtCost = (usd: number) => (usd === 0 ? '$0' : usd < 0.0001 ? '<$0.0001' : `$${usd.toFixed(4)}`);

export const VoiceComparisonPage: React.FC = () => {
  const secret = readLocal('jarvis_auth_token');
  const gemini = useMemo(() => {
    let style = '';
    try {
      style = JSON.parse(readLocal('jarvis_voice_tuning') || '{}').style || '';
    } catch {}
    return {
      voice: readLocal('jarvis_custom_designed_voice_id') || 'voice_5r8hqutci8lm',
      style: style || 'calm, precise, dryly understated',
      apiKey: readLocal('jarvis_gemini_api_key'),
    };
  }, []);

  const [voices, setVoices] = useState<LabVoice[]>([]);
  const [loadError, setLoadError] = useState('');
  const [customLine, setCustomLine] = useState('');
  const [results, setResults] = useState<Record<string, { metrics: LabMetrics; fromCache: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [blind, setBlind] = useState<BlindState | null>(() => loadBlindState());
  const [polish, setPolishState] = useState<LabPolish>(() => loadPolish());
  useEffect(() => {
    applyPolishSettings(polish);
    try {
      localStorage.setItem(POLISH_STORAGE_KEY, JSON.stringify(polish));
    } catch {}
  }, [polish]);

  // Per-voice delivery tuning (Deepgram speed / Flux expressivity); each setting is its own cached clip
  const [tunings, setTunings] = useState<Record<string, VoiceTuning>>(() => loadTunings());
  const tuningFor = useCallback((v: LabVoice) => (v.tunable ? tunings[v.id] || DEFAULT_TUNING : undefined), [tunings]);
  const setTuning = (id: string, patch: Partial<VoiceTuning>) =>
    setTunings((all) => {
      const next = { ...all, [id]: { ...(all[id] || DEFAULT_TUNING), ...patch } };
      try {
        localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  useEffect(() => {
    const headers: Record<string, string> = { 'x-jarvis-secret': secret };
    if (gemini.apiKey) headers['x-gemini-api-key'] = gemini.apiKey;
    fetch('/api/voice-lab?action=providers', { headers })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        setVoices(data.voices);
      })
      .catch((e) => setLoadError(String(e.message || e)));
    reloadCachedResults();
    return () => stopAll();
  }, [secret, gemini.apiKey]);

  function reloadCachedResults() {
    loadAllCachedMetrics().then((all) => {
      const restored: Record<string, { metrics: LabMetrics; fromCache: boolean }> = {};
      for (const [k, m] of Object.entries(all)) restored[k] = { metrics: m, fromCache: true };
      setResults((prev) => ({ ...restored, ...prev }));
    });
  }

  useEffect(() => saveBlindState(blind), [blind]);

  const lines = useMemo(
    () => (customLine.trim() ? [...TEST_LINES, customLine.trim()] : TEST_LINES),
    [customLine]
  );

  const configured = voices.filter((v) => v.configured);
  const rows: LabVoice[] = useMemo(() => {
    if (!blind) return voices;
    const byId = new Map(configured.map((v) => [v.id, v]));
    return blind.order.map((id) => byId.get(id)).filter(Boolean) as LabVoice[];
  }, [blind, voices, configured]);

  const handlePlay = useCallback(
    async (voice: LabVoice, text: string, regenerate: boolean) => {
      const tuning = tuningFor(voice);
      const key = cellKey(voice, text, gemini, tuning);
      setBusy(key);
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
      try {
        const res = await playCell({ voice, text, regenerate, gemini, secret, tuning });
        setResults((r) => ({ ...r, [key]: { metrics: res.metrics, fromCache: res.fromBrowserCache } }));
      } catch (err) {
        setErrors((e) => ({ ...e, [key]: String((err as Error).message || err) }));
      } finally {
        setBusy((b) => (b === key ? null : b));
      }
    },
    [gemini, secret, tuningFor]
  );

  const startBlind = () => {
    stopAll();
    setBlind({ order: shuffle(configured.map((v) => v.id)), ratings: {}, revealed: false });
  };

  const summary = useMemo(() => {
    if (!blind?.revealed) return [];
    return rows
      .map((v, i) => {
        const ms = lines
          .map((t) => results[cellKey(v, t, gemini, tuningFor(v))]?.metrics)
          .filter((m): m is LabMetrics => Boolean(m && !m.serverCacheHit));
        const avg = (pick: (m: LabMetrics) => number) =>
          ms.length ? ms.reduce((s, m) => s + pick(m), 0) / ms.length : null;
        const chars = ms.reduce((s, m) => s + m.chars, 0);
        const cost = ms.reduce((s, m) => s + m.costUsd, 0);
        return {
          voice: v,
          label: `Voice ${String.fromCharCode(65 + i)}`,
          rating: blind.ratings[v.id] || 0,
          ttfa: avg((m) => m.ttfaMs),
          total: avg((m) => m.totalMs),
          per1k: chars ? (cost / chars) * 1000 : null,
        };
      })
      .sort((a, b) => b.rating - a.rating);
  }, [blind, rows, lines, results, gemini, tuningFor]);

  if (!secret) {
    return (
      <Shell>
        <p className="text-amber-200">Unlock the Jarvis HUD first, then come back to this page.</p>
        <a href="#" className="text-amber-400 underline">
          Back to Jarvis
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href="#" onClick={() => stopAll()} className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-200">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Jarvis
          </a>
          <h1 className="font-orbitron text-lg sm:text-xl text-amber-200 tracking-widest mt-1">VOICE COMPARISON</h1>
          <p className="text-xs text-amber-500/90 max-w-2xl">
            Each line is generated once per voice and cached in this browser (and on the server), so replays are
            free. Use ↻ to force a fresh generation. Nothing here changes Jarvis's live voice.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => stopAll()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-amber-800 text-xs text-amber-300 hover:border-amber-500"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
          {blind ? (
            <button
              onClick={() => setBlind(null)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-amber-500 bg-amber-950/60 text-xs text-amber-200"
            >
              <EyeOff className="w-3.5 h-3.5" /> Exit blind test
            </button>
          ) : (
            <button
              onClick={startBlind}
              disabled={configured.length < 2}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-black text-xs font-bold disabled:opacity-40"
            >
              <EyeOff className="w-3.5 h-3.5" /> Start blind test
            </button>
          )}
        </div>
      </div>

      {loadError && <div className="text-sm text-red-300">Could not load providers: {loadError}</div>}

      <label className="block space-y-1">
        <span className="text-xs text-amber-300">Your own line (adds a column)</span>
        <input
          value={customLine}
          maxLength={400}
          onChange={(e) => setCustomLine(e.target.value)}
          placeholder='e.g. "Shall I order the usual, sir?"'
          className="w-full bg-black/80 border border-amber-800 focus:border-amber-400 rounded-lg px-3 py-2 text-sm text-amber-100 placeholder-amber-800 outline-none"
        />
      </label>

      {!blind && voices.length > 0 && (
        <AutoMatchPanel
          voices={voices}
          lines={TEST_LINES}
          gemini={gemini}
          secret={secret}
          tuningFor={tuningFor}
          onTuningChange={setTuning}
          polish={polish}
          onPolishChange={(patch) => setPolishState((p) => ({ ...p, ...patch }))}
          onClipsGenerated={reloadCachedResults}
        />
      )}

      <PolishPanel polish={polish} onChange={(patch) => setPolishState((p) => ({ ...p, ...patch }))} />

      {blind && !blind.revealed && (
        <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
          Blind test: names, prices and timings are hidden and rows are shuffled. Play the lines, rate each voice
          from 1 to 5 stars, then press <strong>Finish and reveal</strong>.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-amber-900/70">
        <table className="w-full text-left border-collapse table-fixed min-w-[880px]">
          <thead>
            <tr className="bg-black/60">
              <th className="p-2 text-[11px] text-amber-400 font-normal w-44 sm:w-56 sticky left-0 z-10 bg-[#0b0d10]">Voice</th>
              {lines.map((line, i) => (
                <th key={i} className="p-2 text-[11px] text-amber-400 font-normal align-top w-40">
                  {i < TEST_LINES.length ? `Line ${i + 1}` : 'Your line'}
                  <div className="text-amber-600 font-normal normal-case line-clamp-2" title={line}>
                    {line}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((voice, rowIndex) => (
              <tr key={voice.id} className="border-t border-amber-900/50 align-top">
                <td className="p-2 sticky left-0 z-10 bg-[#0b0d10] w-44 sm:w-56">
                  {blind && !blind.revealed ? (
                    <div className="space-y-1.5">
                      <div className="font-orbitron text-sm text-amber-200">
                        Voice {String.fromCharCode(65 + rowIndex)}
                      </div>
                      <StarRating
                        value={blind.ratings[voice.id] || 0}
                        onChange={(n) =>
                          setBlind((b) => (b ? { ...b, ratings: { ...b.ratings, [voice.id]: n } } : b))
                        }
                      />
                    </div>
                  ) : (
                    <div className={voice.configured ? '' : 'opacity-50'}>
                      <div className="text-sm text-amber-200">{voice.providerName}</div>
                      <div className="text-[11px] font-mono-tech text-amber-400">{voice.voiceName}</div>
                      <div className="text-[10px] text-amber-600">{voice.accent}</div>
                      <div className="text-[10px] text-amber-500 mt-1" title={voice.streamNote}>
                        {voice.streaming ? '● streams' : '○ no streaming'} · {voice.priceText}
                      </div>
                      {voice.tunable && voice.configured && (
                        <TuningControls
                          voice={voice}
                          tuning={tuningFor(voice) || DEFAULT_TUNING}
                          onChange={(patch) => setTuning(voice.id, patch)}
                        />
                      )}
                      {!voice.configured && (
                        <div className="text-[10px] text-red-300 mt-1">
                          Not configured: set {voice.envVars.join(' + ')}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                {lines.map((line) => {
                  const key = cellKey(voice, line, gemini, tuningFor(voice));
                  const result = results[key];
                  const isBusy = busy === key;
                  const hideNumbers = Boolean(blind && !blind.revealed);
                  return (
                    <td key={line} className="p-2 w-40 max-w-[10rem]">
                      {voice.configured ? (
                        <div className="space-y-1">
                          <div className="flex gap-1">
                            <button
                              onClick={() => handlePlay(voice, line, false)}
                              disabled={Boolean(busy) && !isBusy}
                              className="inline-flex items-center justify-center w-9 h-8 rounded bg-amber-500 text-black disabled:opacity-40"
                              aria-label="Play"
                            >
                              {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            </button>
                            {result && (
                              <button
                                onClick={() => handlePlay(voice, line, true)}
                                disabled={Boolean(busy)}
                                title="Regenerate (bypasses the cache and calls the provider again)"
                                className="inline-flex items-center justify-center w-8 h-8 rounded border border-amber-800 text-amber-400 hover:border-amber-500 disabled:opacity-40"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {result && !hideNumbers && <MetricsView metrics={result.metrics} fromCache={result.fromCache} />}
                          {result && hideNumbers && <div className="text-[10px] text-amber-600">played</div>}
                          {errors[key] && (
                            <div className="text-[10px] text-red-300 break-words line-clamp-3" title={errors[key]}>
                              {errors[key]}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-amber-800">not configured</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {blind && !blind.revealed && (
        <button
          onClick={() => {
            stopAll();
            setBlind((b) => (b ? { ...b, revealed: true } : b));
          }}
          className="px-4 py-2 rounded bg-amber-500 text-black text-sm font-bold"
        >
          Finish and reveal
        </button>
      )}

      {blind?.revealed && (
        <div className="space-y-2">
          <h2 className="font-orbitron text-sm text-amber-200 tracking-widest">BLIND TEST RESULTS</h2>
          <div className="overflow-x-auto rounded-xl border border-amber-900/70">
            <table className="w-full text-left text-xs border-collapse min-w-[560px]">
              <thead className="bg-black/60 text-amber-400">
                <tr>
                  <th className="p-2 font-normal">Rank</th>
                  <th className="p-2 font-normal">Rating</th>
                  <th className="p-2 font-normal">Was</th>
                  <th className="p-2 font-normal">Avg first audio</th>
                  <th className="p-2 font-normal">Avg total</th>
                  <th className="p-2 font-normal">Est. cost / 1K chars</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s, i) => (
                  <tr key={s.voice.id} className="border-t border-amber-900/50 text-amber-200">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 text-amber-400">{s.rating ? '★'.repeat(s.rating) : 'unrated'}</td>
                    <td className="p-2">
                      <span className="text-amber-500">{s.label} = </span>
                      {s.voice.providerName} · <span className="font-mono-tech">{s.voice.voiceName}</span>
                    </td>
                    <td className="p-2">{s.ttfa != null ? fmtSec(s.ttfa) : 'n/a'}</td>
                    <td className="p-2">{s.total != null ? fmtSec(s.total) : 'n/a'}</td>
                    <td className="p-2">{s.per1k != null ? fmtCost(s.per1k) : s.voice.priceText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-amber-600">
            Timings average the first generation of each line (cache replays excluded).
          </p>
          <button onClick={startBlind} className="px-3 py-1.5 rounded border border-amber-700 text-xs text-amber-300">
            Run another blind test
          </button>
        </div>
      )}

      <details className="text-xs text-amber-500/90">
        <summary className="cursor-pointer text-amber-300">How these numbers are measured</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>
            <strong>First audio</strong>: from pressing play until sound starts (includes network and, for
            non-streaming voices, the full download).
          </li>
          <li>
            <strong>Total</strong>: until the last byte of audio arrives.
          </li>
          <li>
            <strong>Cost</strong>: list price for that one generation (per character, or per second of audio for
            OpenAI and Gemini). Free tiers are not subtracted.
          </li>
          <li>
            <strong>"cached"</strong> rows show the numbers from the original generation; replaying costs nothing.
          </li>
          <li>
            "&lt;short pause&gt;" is sent as-is to Gemini and becomes a comma pause for every other engine, like the
            live pipeline.
          </li>
        </ul>
      </details>
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-[100dvh] w-full overflow-y-auto bg-[#07090c] text-amber-100">
    <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">{children}</div>
  </div>
);

const MetricsView: React.FC<{ metrics: LabMetrics; fromCache: boolean }> = ({ metrics, fromCache }) => (
  <div className="text-[10px] font-mono-tech leading-tight text-amber-300/90">
    <div>
      first {fmtSec(metrics.ttfaMs)} · total {fmtSec(metrics.totalMs)}
    </div>
    <div className="text-amber-500">
      {metrics.chars} chars · {fmtCost(metrics.costUsd)}
    </div>
    <div className="text-amber-700">
      {metrics.streamedPlayback ? 'streamed' : 'buffered'}
      {fromCache ? ' · cached' : ''}
      {metrics.serverCacheHit ? ' · server cache' : ''}
    </div>
  </div>
);

const PolishPanel: React.FC<{ polish: LabPolish; onChange: (patch: Partial<LabPolish>) => void }> = ({
  polish,
  onChange,
}) => {
  const slider = (
    label: string,
    value: number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string
  ) => (
    <label className="block min-w-[150px] flex-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-amber-300">{label}</span>
        <span className="text-amber-200 font-mono-tech">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!polish.enabled}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-amber-400 disabled:opacity-40"
      />
    </label>
  );
  const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  const setMatch = (patch: Partial<LabPolish['match']>) => onChange({ match: { ...polish.match, ...patch } });
  return (
    <div className="rounded-xl border border-amber-800/70 bg-amber-950/20 p-3 space-y-3">
      <label className="flex items-center gap-2 text-xs text-amber-200">
        <input
          type="checkbox"
          checked={polish.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="accent-amber-400"
        />
        <span>
          <strong>Jarvis polish</strong>: hear every voice through the live app's sound processing. Applies to
          replays instantly at no cost (clips then play after download).
        </span>
      </label>
      <div>
        <div className="text-[10px] text-amber-500 mb-1">Live app sound (all voices)</div>
        <div className="flex flex-wrap gap-4">
          {slider('Chest warmth', polish.warmthDb, (v) => onChange({ warmthDb: v }), -3, 6, 0.5, db)}
          {slider('Diction crispness', polish.presenceDb, (v) => onChange({ presenceDb: v }), -2, 6, 0.5, db)}
          {slider('Suit intercom sheen', polish.intercomWet, (v) => onChange({ intercomWet: v }), 0, 0.3, 0.01, (v) => `${Math.round(v * 100)}%`)}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-amber-500 mb-1">
          Match adjustments (every voice except Gemini, which stays the reference). Auto-match sets these.
        </div>
        <div className="flex flex-wrap gap-4">
          {slider('Pitch', polish.match.pitchSemitones, (v) => setMatch({ pitchSemitones: v }), -3, 3, 0.25, (v) => `${v > 0 ? '+' : ''}${v} st`)}
          {slider('Extra warmth', polish.match.warmthDelta, (v) => setMatch({ warmthDelta: v }), -6, 6, 0.5, db)}
          {slider('Extra crispness', polish.match.presenceDelta, (v) => setMatch({ presenceDelta: v }), -6, 6, 0.5, db)}
        </div>
      </div>
    </div>
  );
};

const TuningControls: React.FC<{
  voice: LabVoice;
  tuning: VoiceTuning;
  onChange: (patch: Partial<VoiceTuning>) => void;
}> = ({ voice, tuning, onChange }) => {
  const t = voice.tunable!;
  const speeds: number[] = [];
  for (let v = t.speedMin; v <= t.speedMax + 1e-9; v += 0.05) speeds.push(Math.round(v * 100) / 100);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <label className="text-[10px] text-amber-400">
        speed{' '}
        <select
          value={tuning.speed}
          onChange={(e) => onChange({ speed: Number(e.target.value) })}
          className="bg-black border border-amber-800 rounded px-1 py-0.5 text-amber-200"
        >
          {speeds.map((v) => (
            <option key={v} value={v}>
              {v.toFixed(2)}
            </option>
          ))}
        </select>
      </label>
      {t.expressivity && (
        <label className="text-[10px] text-amber-400">
          delivery{' '}
          <select
            value={tuning.expressivity}
            onChange={(e) => onChange({ expressivity: Number(e.target.value) })}
            className="bg-black border border-amber-800 rounded px-1 py-0.5 text-amber-200"
          >
            {[-2, -1, 0, 1, 2].map((v) => (
              <option key={v} value={v}>
                {EXPRESSIVITY_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
};

const StarRating: React.FC<{ value: number; onChange: (n: number) => void }> = ({ value, onChange }) => (
  <div className="flex gap-0.5" role="radiogroup" aria-label="Rating">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} onClick={() => onChange(n)} aria-label={`${n} stars`} className="p-0.5">
        <Star className={`w-4 h-4 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-amber-800'}`} />
      </button>
    ))}
  </div>
);
