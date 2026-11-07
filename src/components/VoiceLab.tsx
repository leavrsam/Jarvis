import React, { useEffect, useState } from 'react';
import { FlaskConical, Loader2, Play, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { audioEngine, DEFAULT_VOICE_TUNING, JarvisVoiceTuning, SpeechDiagnostic } from '../services/audioEngine';

const DEFAULT_TEST_LINE =
  'Good evening, sir. I have taken the liberty of running a full diagnostic. Everything appears to be in order, although your coffee has gone cold again.';

// Quick relative adjustments for "remix" (applied on top of the current voice)
const REMIX_SUGGESTIONS = [
  'A touch lighter and younger',
  'Slightly deeper and warmer',
  'Quicker, more clipped delivery',
  'Softer, closer to the microphone',
  'Drier, more understated',
  'More precise, crisper consonants',
];

interface VoiceLabProps {
  onPreview: (text: string) => void;
  onVoiceChanged: (voiceId: string) => void;
}

export const VoiceLab: React.FC<VoiceLabProps> = ({ onPreview, onVoiceChanged }) => {
  const [tuning, setTuning] = useState<JarvisVoiceTuning>(() => audioEngine.getVoiceTuning());
  const [styleDraft, setStyleDraft] = useState<string>(() => audioEngine.getVoiceTuning().style);
  const [testLine, setTestLine] = useState(DEFAULT_TEST_LINE);
  const [remixPrompt, setRemixPrompt] = useState('');
  const [isRemixing, setIsRemixing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [history, setHistory] = useState<string[]>(() => audioEngine.getVoiceHistory());
  const [activeVoice, setActiveVoice] = useState<string>(() => audioEngine.getCustomDesignedVoiceId());

  // Live per-sentence playback log so problems (slow Gemini, fallbacks, errors) are visible
  const [diagnostics, setDiagnostics] = useState<SpeechDiagnostic[]>(() => audioEngine.getSpeechDiagnostics());
  useEffect(() => {
    const t = setInterval(() => setDiagnostics(audioEngine.getSpeechDiagnostics()), 700);
    return () => clearInterval(t);
  }, []);

  const updateTuning = (patch: Partial<JarvisVoiceTuning>) => {
    setTuning(audioEngine.setVoiceTuning(patch));
  };

  const applyStyle = () => {
    updateTuning({ style: styleDraft.trim() });
    setStatusMsg('Delivery direction saved. Press Play to hear it.');
  };

  const handleRemix = async (fromScratch: boolean) => {
    const prompt = remixPrompt.trim();
    if (!prompt) {
      setStatusMsg('Describe the change first, e.g. "a touch lighter and quicker".');
      return;
    }
    setIsRemixing(true);
    setStatusMsg(fromScratch ? 'Designing a new voice...' : `Remixing ${activeVoice || 'current voice'}...`);
    try {
      const base = fromScratch ? undefined : activeVoice || undefined;
      // Google's remixing guide: anchor identity explicitly and describe only the change
      const instruction =
        base && !/keep the same/i.test(prompt)
          ? `Keep the same speaker identity and accent, but make it ${prompt.charAt(0).toLowerCase()}${prompt.slice(1).replace(/[.!]+$/, '')}.`
          : prompt;
      const newId = await audioEngine.designCustomJarvisVoice(instruction, base, `Remix: ${prompt.slice(0, 28)}`);
      if (newId) {
        setActiveVoice(newId);
        setHistory(audioEngine.getVoiceHistory());
        onVoiceChanged(newId);
        setStatusMsg(`New voice ${newId} is active. Playing test line...`);
        onPreview(testLine);
      }
    } catch (err: unknown) {
      setStatusMsg(`Voice Design error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRemixing(false);
    }
  };

  const handleCreateRefined = async () => {
    setIsRemixing(true);
    try {
      const newId = await audioEngine.createRefinedJarvisVoice((msg) => setStatusMsg(msg));
      setActiveVoice(newId);
      setHistory(audioEngine.getVoiceHistory());
      setTuning(audioEngine.getVoiceTuning());
      setStyleDraft('');
      onVoiceChanged(newId);
      setStatusMsg(`Refined Mk-VIII (${newId}) is now active. Tap "Original Mk-VII" below to compare.`);
      onPreview(testLine);
    } catch (err: unknown) {
      setStatusMsg(`Voice Design error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRemixing(false);
    }
  };

  const useVoice = (voiceId: string) => {
    audioEngine.setCustomDesignedVoiceId(voiceId);
    setActiveVoice(voiceId);
    onVoiceChanged(voiceId);
    setStatusMsg(`Switched to ${voiceId}.`);
    onPreview(testLine);
  };

  const slider = (
    label: string,
    hint: string,
    key: 'warmthDb' | 'presenceDb' | 'intercomWet',
    min: number,
    max: number,
    step: number,
    format: (v: number) => string
  ) => (
    <label className="block space-y-1">
      <div className="flex justify-between text-[10px] font-mono-tech">
        <span className="text-amber-300">{label}</span>
        <span className="text-amber-200">{format(tuning[key])}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={tuning[key]}
        onChange={(e) => updateTuning({ [key]: Number(e.target.value) })}
        className="w-full accent-amber-400"
      />
      <div className="text-[9px] text-amber-500/80">{hint}</div>
    </label>
  );

  return (
    <div className="p-3 sm:p-3.5 rounded-xl border border-amber-800/60 bg-amber-950/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-orbitron text-amber-200">
          <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
          <span>VOICE LAB</span>
        </div>
        <button
          onClick={() => {
            setTuning(audioEngine.resetVoiceTuning());
            setStyleDraft('');
            setStatusMsg('Tuning reset to defaults.');
          }}
          className="flex items-center space-x-1 text-[9px] font-mono-tech text-amber-400 hover:text-amber-200"
        >
          <RotateCcw className="w-3 h-3" />
          <span>RESET</span>
        </button>
      </div>

      {/* Test line */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono-tech text-amber-300">Test line</div>
        <textarea
          value={testLine}
          onChange={(e) => setTestLine(e.target.value)}
          rows={2}
          className="w-full bg-black/80 border border-amber-800 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-100 outline-none resize-none"
        />
        <button
          onClick={() => onPreview(testLine)}
          className="w-full flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 text-xs font-orbitron font-bold"
        >
          <Play className="w-3.5 h-3.5" />
          <span>PLAY</span>
        </button>
      </div>

      {/* One-tap refined voice */}
      <button
        onClick={handleCreateRefined}
        disabled={isRemixing}
        className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg border border-emerald-500/70 bg-emerald-950/40 hover:bg-emerald-900/50 text-[11px] font-orbitron text-emerald-200 disabled:opacity-50"
      >
        {isRemixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        <span>CREATE REFINED JARVIS (MK-VIII)</span>
      </button>

      {/* 1. Voice identity: remix the designed voice */}
      <div className="space-y-1.5 pt-2 border-t border-amber-900/50">
        <div className="text-[10px] font-mono-tech text-amber-300">
          1. Voice identity <span className="text-amber-500/80">(timbre, age, depth: creates a new voice)</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {REMIX_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setRemixPrompt(s)}
              className="px-2 py-0.5 rounded-full border border-amber-800 text-[9px] text-amber-300 hover:border-amber-500"
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={remixPrompt}
          onChange={(e) => setRemixPrompt(e.target.value)}
          placeholder="Describe the change, e.g. a touch lighter and quicker"
          className="w-full bg-black/80 border border-amber-800 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-100 placeholder-amber-800 outline-none"
        />
        <div className="flex gap-2">
          <button
            onClick={() => handleRemix(false)}
            disabled={isRemixing}
            className="flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded border border-amber-600/60 bg-amber-950/50 hover:bg-amber-900/60 text-[10px] font-orbitron text-amber-200 disabled:opacity-50"
          >
            {isRemixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            <span>REMIX CURRENT</span>
          </button>
          <button
            onClick={() => handleRemix(true)}
            disabled={isRemixing}
            title="Treat the text as a full description and design a brand-new voice"
            className="px-2 py-1.5 rounded border border-amber-900 text-[10px] font-orbitron text-amber-400 hover:border-amber-600 disabled:opacity-50"
          >
            NEW FROM TEXT
          </button>
        </div>
        {history.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-amber-500/80">Recent voices (tap to A/B):</div>
            <div className="flex flex-wrap gap-1">
              {history.map((id) => (
                <button
                  key={id}
                  title={id}
                  onClick={() => useVoice(id)}
                  className={`px-2 py-0.5 rounded border text-[9px] font-mono-tech ${
                    id === activeVoice
                      ? 'border-emerald-500 text-emerald-300 bg-emerald-950/40'
                      : 'border-amber-800 text-amber-300 hover:border-amber-500'
                  }`}
                >
                  {audioEngine.getVoiceLabel(id)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Delivery direction */}
      <div className="space-y-1.5 pt-2 border-t border-amber-900/50">
        <div className="text-[10px] font-mono-tech text-amber-300">
          2. Delivery <span className="text-amber-500/80">(pace, mood, attitude: sent with every line)</span>
        </div>
        <textarea
          value={styleDraft}
          onChange={(e) => setStyleDraft(e.target.value)}
          rows={3}
          placeholder={audioEngine.getVoicePreset().style}
          className="w-full bg-black/80 border border-amber-800 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-100 placeholder-amber-700 outline-none resize-none"
        />
        <button
          onClick={applyStyle}
          className="w-full px-2 py-1.5 rounded border border-amber-600/60 bg-amber-950/50 hover:bg-amber-900/60 text-[10px] font-orbitron text-amber-200"
        >
          SAVE DELIVERY
        </button>
      </div>

      {/* 3. Polish */}
      <div className="space-y-2 pt-2 border-t border-amber-900/50">
        <div className="text-[10px] font-mono-tech text-amber-300">
          3. Polish <span className="text-amber-500/80">(in-browser EQ: instant, no new voice)</span>
        </div>
        {slider('Chest warmth', 'Body in the low voice (190 Hz)', 'warmthDb', -3, 6, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)}
        {slider('Diction crispness', 'Sharpness of t, k, s (3.6 kHz)', 'presenceDb', -2, 6, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)}
        {slider('Suit intercom sheen', 'Short metallic reflection', 'intercomWet', 0, 0.3, 0.01, (v) => `${Math.round(v * 100)}%`)}
        <div className="text-[9px] text-amber-600">
          Defaults: warmth +{DEFAULT_VOICE_TUNING.warmthDb} dB, crispness +{DEFAULT_VOICE_TUNING.presenceDb} dB, sheen{' '}
          {Math.round(DEFAULT_VOICE_TUNING.intercomWet * 100)}%. Requires the HUD DSP preset to be active.
        </div>
      </div>

      {/* Playback diagnostics */}
      {diagnostics.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-amber-900/50">
          <div className="text-[10px] font-mono-tech text-amber-300">
            Last playback <span className="text-amber-500/80">(newest first)</span>
          </div>
          {diagnostics.slice(0, 6).map((d, i) => (
            <div
              key={i}
              className={`text-[9px] font-mono-tech px-2 py-1 rounded border ${
                d.fallback ? 'border-red-800 bg-red-950/30 text-red-300' : 'border-emerald-900 bg-emerald-950/20 text-emerald-300'
              }`}
            >
              <div className="flex justify-between gap-2">
                <span className="truncate">"{d.text}"</span>
                <span className="shrink-0">
                  {d.engine} · {(d.ms / 1000).toFixed(1)}s
                </span>
              </div>
              {d.note && <div className="text-amber-400/90 break-words">{d.note}</div>}
            </div>
          ))}
        </div>
      )}

      {statusMsg && (
        <div className="text-[10px] font-mono-tech text-amber-300 bg-black/60 px-2.5 py-1 rounded border border-amber-900">
          {statusMsg}
        </div>
      )}
    </div>
  );
};
