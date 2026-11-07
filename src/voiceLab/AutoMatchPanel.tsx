import React, { useMemo, useState } from 'react';
import { Loader2, Play, Wand2 } from 'lucide-react';
import {
  LabPolish,
  LabVoice,
  MatchAdjust,
  NO_MATCH,
  VoiceTuning,
  cellKey,
  getCachedBuffer,
  playCell,
  playSequence,
  renderProcessed,
} from './labClient';
import { VoiceProfile, profileClips, suggestMatch } from './voiceAnalysis';

interface Props {
  voices: LabVoice[];
  lines: string[];
  gemini: { voice: string; style: string; apiKey: string };
  tuningFor: (v: LabVoice) => VoiceTuning | undefined;
  onTuningChange: (id: string, patch: Partial<VoiceTuning>) => void;
  polish: LabPolish;
  onPolishChange: (patch: Partial<LabPolish>) => void;
  /** Called after clips were generated so the grid can show them */
  onClipsGenerated: () => void;
}

interface MatchReport {
  targetId: string;
  lineCount: number;
  generated: number;
  reference: VoiceProfile;
  before: VoiceProfile;
  after: VoiceProfile;
  match: MatchAdjust;
  speed: number | null;
  currentSpeed: number | null;
  expressivityHint: string | null;
  buffers: { ref: AudioBuffer; target: AudioBuffer };
}

const fmtHz = (v: number) => (v ? `${v.toFixed(0)} Hz` : 'n/a');
const fmtSt = (v: number) => `${v.toFixed(1)} st`;
const fmtS = (v: number) => `${v.toFixed(2)} s`;
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v}${unit}`;

export const AutoMatchPanel: React.FC<Props> = ({
  voices,
  lines,
  gemini,
  tuningFor,
  onTuningChange,
  polish,
  onPolishChange,
  onClipsGenerated,
}) => {
  const reference = voices.find((v) => v.provider === 'gemini');
  const candidates = voices.filter((v) => v.configured && v.provider !== 'gemini');
  const [targetId, setTargetId] = useState<string>(
    () => candidates.find((v) => v.id === 'flux-jack')?.id || candidates[0]?.id || ''
  );
  const target = useMemo(() => candidates.find((v) => v.id === targetId) || candidates[0], [candidates, targetId]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<MatchReport | null>(null);

  if (!reference) return null;
  if (!reference.configured) {
    return (
      <Box>
        <p className="text-xs text-amber-400">
          Auto-match uses the Gemini voice as the reference, and Gemini isn't configured on the server or in this
          browser yet.
        </p>
      </Box>
    );
  }
  if (!target) return null;

  const loadBuffer = async (voice: LabVoice, line: string, generatedCount: { n: number }) => {
    const tuning = tuningFor(voice);
    const key = cellKey(voice, line, gemini, tuning);
    let buffer = await getCachedBuffer(key);
    if (!buffer) {
      setStatus(`Generating "${line.slice(0, 32)}..." for ${voice.voiceName}`);
      await playCell({ voice, text: line, regenerate: false, gemini, tuning, silent: true });
      generatedCount.n++;
      buffer = await getCachedBuffer(key);
    }
    if (!buffer) throw new Error(`No audio for ${voice.voiceName}`);
    return buffer;
  };

  const runMatch = async () => {
    setBusy(true);
    setReport(null);
    try {
      const generated = { n: 0 };
      const refBuffers: AudioBuffer[] = [];
      const tgtBuffers: AudioBuffer[] = [];
      for (const line of lines) {
        refBuffers.push(await loadBuffer(reference, line, generated));
        tgtBuffers.push(await loadBuffer(target, line, generated));
      }
      if (generated.n) onClipsGenerated();

      setStatus('Measuring...');
      // Measure what you'd actually hear: both through the live app's chain; the target with its adjustments
      const render = async (buffers: AudioBuffer[], adj: MatchAdjust) =>
        profileClips(
          await Promise.all(
            buffers.map(async (b) => ({ samples: await renderProcessed(b, adj), sampleRate: b.sampleRate }))
          )
        );
      const refProfile = await render(refBuffers, NO_MATCH);
      const beforeProfile = await render(tgtBuffers, NO_MATCH);

      const tuning = tuningFor(target);
      const speedInfo =
        target.tunable && tuning
          ? { current: tuning.speed, min: target.tunable.speedMin, max: target.tunable.speedMax }
          : null;

      // Two passes: suggest, render with it, then correct whatever residual the filters left
      let match: MatchAdjust = { ...NO_MATCH };
      let afterProfile = beforeProfile;
      let speed: number | null = null;
      for (let pass = 0; pass < 2; pass++) {
        const s = suggestMatch(refProfile, afterProfile, match, speedInfo);
        match = { pitchSemitones: s.pitchSemitones, warmthDelta: s.warmthDelta, presenceDelta: s.presenceDelta };
        if (pass === 0) speed = s.speed;
        setStatus(`Refining (pass ${pass + 1} of 2)...`);
        afterProfile = await render(tgtBuffers, match);
      }

      let expressivityHint: string | null = null;
      if (target.tunable?.expressivity && tuning) {
        const gap = refProfile.f0SpreadSt - beforeProfile.f0SpreadSt;
        if (gap > 0.5 && tuning.expressivity < 2)
          expressivityHint = `Gemini's pitch moves more (${fmtSt(refProfile.f0SpreadSt)} vs ${fmtSt(beforeProfile.f0SpreadSt)}). Try delivery ${signed(tuning.expressivity + 1, '')}.`;
        else if (gap < -0.5 && tuning.expressivity > -2)
          expressivityHint = `${target.voiceName} is more animated than Gemini (${fmtSt(beforeProfile.f0SpreadSt)} vs ${fmtSt(refProfile.f0SpreadSt)}). Try delivery ${signed(tuning.expressivity - 1, '')}.`;
      }

      setReport({
        targetId: target.id,
        lineCount: lines.length,
        generated: generated.n,
        reference: refProfile,
        before: beforeProfile,
        after: afterProfile,
        match,
        speed,
        currentSpeed: tuning?.speed ?? null,
        expressivityHint,
        buffers: { ref: refBuffers[0], target: tgtBuffers[0] },
      });
      setStatus('');
    } catch (err) {
      setStatus(`Auto-match failed: ${(err as Error).message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const applyMatch = () => {
    if (!report) return;
    onPolishChange({ enabled: true, match: report.match });
  };

  const speedDiffers =
    report && report.speed != null && report.currentSpeed != null && Math.abs(report.speed - report.currentSpeed) >= 0.05;

  const rows: [string, (p: VoiceProfile) => string, string][] = [
    ['Average pitch', (p) => fmtHz(p.f0Median), 'How high or low the voice sits'],
    ['Pitch movement', (p) => fmtSt(p.f0SpreadSt), 'Intonation range; low = flatter'],
    ['Speaking time', (p) => fmtS(p.speechSec), `All ${lines.length} lines, silence trimmed; longer = slower`],
    ['Pauses', (p) => fmtS(p.pauseSec), 'Gaps of 150 ms or more'],
    ['Body (100-300 Hz)', (p) => fmtDb(p.bands.body), 'Chest warmth'],
    ['Low-mids (0.3-1 kHz)', (p) => fmtDb(p.bands.lowMid), 'Fullness / boxiness'],
    ['Presence (2-5 kHz)', (p) => fmtDb(p.bands.presence), 'Diction crispness'],
    ['Air (5-10 kHz)', (p) => fmtDb(p.bands.air), 'Breath and sparkle'],
  ];

  return (
    <Box>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="font-orbitron text-xs text-amber-200 tracking-widest">AUTO-MATCH TO GEMINI</div>
          <p className="text-[11px] text-amber-500/90 max-w-xl">
            Measures pitch, pace and tone on the {lines.length} test lines, then sets pitch and EQ so the chosen voice
            sits closer to Gemini through the live app's sound. Missing clips are generated once (a few cents).
          </p>
        </div>
        <label className="text-[11px] text-amber-300">
          Voice to match{' '}
          <select
            value={target.id}
            onChange={(e) => {
              setTargetId(e.target.value);
              setReport(null);
            }}
            className="bg-black border border-amber-800 rounded px-1.5 py-1 text-amber-200"
          >
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.providerName}: {v.voiceName}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={runMatch}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-black text-xs font-bold disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Analyze and match
        </button>
      </div>

      {status && <div className="text-[11px] text-amber-300">{status}</div>}

      {report && report.targetId === target.id && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse min-w-[520px]">
              <thead className="text-amber-400">
                <tr>
                  <th className="text-left font-normal p-1">Measurement</th>
                  <th className="text-left font-normal p-1">Gemini</th>
                  <th className="text-left font-normal p-1">{target.voiceName} now</th>
                  <th className="text-left font-normal p-1">After match</th>
                </tr>
              </thead>
              <tbody className="font-mono-tech text-amber-200">
                {rows.map(([label, f, hint]) => (
                  <tr key={label} className="border-t border-amber-900/50" title={hint}>
                    <td className="p-1 font-sans text-amber-300">{label}</td>
                    <td className="p-1">{f(report.reference)}</td>
                    <td className="p-1">{f(report.before)}</td>
                    <td className="p-1 text-emerald-300">{f(report.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-amber-200 space-y-1">
            <div>
              Suggested adjustments for {target.voiceName}: pitch{' '}
              <strong>{signed(report.match.pitchSemitones, ' st')}</strong>, chest warmth{' '}
              <strong>{signed(report.match.warmthDelta, ' dB')}</strong>, crispness{' '}
              <strong>{signed(report.match.presenceDelta, ' dB')}</strong>.
            </div>
            {speedDiffers && (
              <div>
                Pace: {target.voiceName} at speed {report.currentSpeed?.toFixed(2)} takes{' '}
                {fmtS(report.before.speechSec)} vs Gemini's {fmtS(report.reference.speechSec)}. Suggested speed{' '}
                <strong>{report.speed?.toFixed(2)}</strong> (needs {report.lineCount} new clips, then re-run).
              </div>
            )}
            {report.expressivityHint && <div>{report.expressivityHint}</div>}
            {report.after.f0SpreadSt - report.before.f0SpreadSt > 1 && (
              <div className="text-red-300">
                The adjustments make the pitch less steady ({fmtSt(report.before.f0SpreadSt)} to{' '}
                {fmtSt(report.after.f0SpreadSt)}), a sign of processing artifacts. Consider leaving pitch at 0.
              </div>
            )}
            {Math.abs(report.reference.f0Median - report.before.f0Median) / report.reference.f0Median < 0.05 &&
              Math.abs(report.reference.speechSec - report.before.speechSec) / report.reference.speechSec < 0.05 && (
                <div className="text-amber-400">
                  Pitch and pace already match within 5%. Remaining differences are character and phrasing, which
                  processing can't change.
                </div>
              )}
            {report.generated > 0 && <div className="text-amber-500">Generated {report.generated} new clips.</div>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={applyMatch} className="px-3 py-1.5 rounded bg-emerald-600 text-black text-xs font-bold">
              Apply match
            </button>
            {speedDiffers && report.speed != null && (
              <button
                onClick={() => {
                  onTuningChange(target.id, { speed: report.speed! });
                  setReport(null);
                  setStatus(`Speed set to ${report.speed!.toFixed(2)}. Run "Analyze and match" again to generate and measure.`);
                }}
                className="px-3 py-1.5 rounded border border-amber-600 text-xs text-amber-200"
              >
                Use speed {report.speed.toFixed(2)}
              </button>
            )}
            <button
              onClick={() =>
                playSequence([
                  { buffer: report.buffers.ref, isReference: true },
                  { buffer: report.buffers.target, isReference: false },
                ])
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-amber-700 text-xs text-amber-300"
              title="Line 1: Gemini, then the matched voice, through the current polish settings"
            >
              <Play className="w-3 h-3" /> A/B: Gemini, then {target.voiceName}
            </button>
          </div>
          <p className="text-[10px] text-amber-600">
            Numbers can't capture accent or character, so judge the result by ear. A/B uses whatever is applied now;
            press "Apply match" first to hear the adjusted version.
            {polish.enabled ? '' : ' (Jarvis polish is off, so A/B currently plays both voices unprocessed.)'}
          </p>
        </div>
      )}
    </Box>
  );
};

const Box: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/10 p-3 space-y-2">{children}</div>
);
