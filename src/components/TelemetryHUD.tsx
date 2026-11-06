import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Cpu,
  Radio,
  Wifi,
  Terminal,
  Volume2,
  Activity,
  Layers,
  Sparkles,
  Lock,
  BatteryCharging,
  Battery,
  Ear,
  KeyRound,
  CheckCircle2,
  Wand2,
  Loader2,
} from 'lucide-react';
import {
  JarvisAudioState,
  JARVIS_NEURAL_VOICES,
  JarvisNeuralVoicePreset,
  audioEngine,
} from '../services/audioEngine';
import { AudioSpectrumMeter } from './AudioSpectrumMeter';
import { BatteryStatus } from '../hooks/useBatteryStatus';

export type WakeWordMode = 'charging_only' | 'always' | 'off';

interface TelemetryHUDProps {
  state: JarvisAudioState;
  isListening: boolean;
  isWakeWordActive: boolean;
  wakeWordMode: WakeWordMode;
  battery: BatteryStatus;
  voiceName: string;
  activeVoicePresetId: string;
  historyLength: number;
  onClearHistory?: () => void;
  onTestVoice?: () => void;
  onLockConsole?: () => void;
  onToggleWakeWordMode?: () => void;
  onSelectVoicePreset?: (preset: JarvisNeuralVoicePreset) => void;
}

export const TelemetryHUD: React.FC<TelemetryHUDProps> = ({
  state,
  isListening,
  isWakeWordActive,
  wakeWordMode,
  battery,
  voiceName,
  activeVoicePresetId,
  historyLength,
  onClearHistory,
  onTestVoice,
  onLockConsole,
  onToggleWakeWordMode,
  onSelectVoicePreset,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [coreFreq, setCoreFreq] = useState<number>(4.82);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  // Gemini 3.8 TTS status & custom voice design states
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => audioEngine.getClientGeminiApiKey());
  const [customVoiceId, setCustomVoiceId] = useState<string>(() =>
    audioEngine.getCustomDesignedVoiceId()
  );
  const [isDesigningVoice, setIsDesigningVoice] = useState<boolean>(false);
  const [designStatusMsg, setDesignStatusMsg] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const timeStr =
        now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
      setCurrentTime(timeStr);
      setCoreFreq(4.8 + Math.sin(Date.now() / 2000) * 0.15);
    };

    const timer = setInterval(updateClock, 50);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    audioEngine.checkServerGeminiStatus().then((status) => {
      setGeminiConfigured(status.geminiConfigured);
      if (status.cachedDesignedVoiceId && !customVoiceId) {
        setCustomVoiceId(status.cachedDesignedVoiceId);
      }
    });
  }, [showVoiceModal, customVoiceId]);

  const handleSaveApiKey = async () => {
    audioEngine.setClientGeminiApiKey(apiKeyInput);
    const status = await audioEngine.checkServerGeminiStatus();
    setGeminiConfigured(status.geminiConfigured);
    setDesignStatusMsg(
      status.geminiConfigured
        ? 'Gemini 3.8 API key active! Click "Test Voice Sample" to hear human synthesis.'
        : 'API key cleared. Using server env var if present.'
    );
  };

  const handleGenerateCustomVoice = async () => {
    setIsDesigningVoice(true);
    setDesignStatusMsg('Designing custom British Jarvis vocal persona via Gemini 3.8...');
    try {
      const createdId = await audioEngine.designCustomJarvisVoice();
      if (createdId) {
        setCustomVoiceId(createdId);
        setDesignStatusMsg(`Custom Voice Created: ${createdId}`);
        onTestVoice?.();
      }
    } catch (err: unknown) {
      setDesignStatusMsg(
        `Error: ${err instanceof Error ? err.message : 'Ensure GEMINI_API_KEY is valid'}`
      );
    } finally {
      setIsDesigningVoice(false);
    }
  };

  const getStateBadge = () => {
    switch (state) {
      case 'listening':
        return {
          text: 'ACOUSTIC SENSOR ARMED',
          bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-400',
          dot: 'bg-cyan-400 animate-ping',
        };
      case 'processing':
        return {
          text: 'NEURAL LINK QUERYING n8n',
          bg: 'bg-amber-500/20 text-amber-300 border-amber-400',
          dot: 'bg-amber-400 animate-pulse',
        };
      case 'speaking':
        return {
          text: 'TRANSMITTING VOCAL SYNTH',
          bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-400',
          dot: 'bg-emerald-400 animate-pulse',
        };
      default:
        if (isWakeWordActive) {
          return {
            text: 'WAKE-WORD ACTIVE: "HEY JARVIS"',
            bg: 'bg-emerald-950/40 text-emerald-300 border-emerald-700/60 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
            dot: 'bg-emerald-400 animate-pulse',
          };
        }
        return {
          text: 'JARVIS MK-VII STANDBY',
          bg: 'bg-blue-950/40 text-cyan-400 border-cyan-800',
          dot: 'bg-cyan-500',
        };
    }
  };

  const badge = getStateBadge();

  return (
    <>
      {/* TOP SCI-FI STATUS BAR */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 border-b border-cyan-900/40 bg-black/50 backdrop-blur-md">
        {/* Left: Branding & Core ID */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded border border-cyan-500/60 flex items-center justify-center bg-cyan-950/30 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-orbitron font-bold text-sm tracking-[0.25em] text-cyan-300 text-glow-cyan">
                  J.A.R.V.I.S.
                </span>
                <span className="text-[10px] font-mono-tech px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-400">
                  SYSTEM OS v4.8
                </span>
              </div>
              <p className="text-[9px] font-mono-tech text-cyan-500/70 tracking-wider">
                MARK-VII AUTONOMOUS PROTOCOL // SESS: jarvis-web
              </p>
            </div>
          </div>
        </div>

        {/* Center: System Status & Wake Word Pill */}
        <div className="hidden md:flex items-center space-x-3">
          <div
            className={`flex items-center space-x-2 px-3.5 py-1 rounded-full border text-xs font-orbitron tracking-widest ${badge.bg} transition-colors duration-300`}
          >
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            <span>{badge.text}</span>
          </div>

          {/* Wake Word Power Mode Button */}
          {onToggleWakeWordMode && (
            <button
              onClick={onToggleWakeWordMode}
              className={`flex items-center space-x-1.5 text-[10px] font-mono-tech px-2.5 py-1 rounded border transition-all ${
                isWakeWordActive
                  ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                  : 'border-cyan-900/50 bg-black/60 text-cyan-500 hover:text-cyan-300'
              }`}
              title="Click to toggle Wake-Word listening mode"
            >
              <Ear className="w-3 h-3 text-cyan-300" />
              <span>
                {wakeWordMode === 'charging_only'
                  ? battery.charging
                    ? 'WAKE: ON POWER (ACTIVE)'
                    : 'WAKE: ON POWER (PAUSED ON BATTERY)'
                  : wakeWordMode === 'always'
                  ? 'WAKE: ALWAYS ON'
                  : 'WAKE: DISABLED'}
              </span>
            </button>
          )}

          {/* Battery Status */}
          <div className="flex items-center space-x-1.5 text-[10px] font-mono-tech text-cyan-400/80 bg-black/60 px-2.5 py-1 rounded border border-cyan-950">
            {battery.charging ? (
              <BatteryCharging className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            ) : (
              <Battery className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>
              {battery.charging ? '⚡' : ''} {Math.round(battery.level * 100)}%{' '}
              {battery.charging ? 'CHARGING' : 'BATTERY'}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 text-[10px] font-mono-tech text-cyan-400/80 bg-black/60 px-2 py-1 rounded border border-cyan-950">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>n8n LINK</span>
          </div>
        </div>

        {/* Right: Telemetry Clock & Diagnostics */}
        <div className="flex items-center space-x-4">
          <div className="text-right">
            <div className="font-orbitron text-xs tracking-widest text-cyan-300 text-glow-cyan">
              {currentTime || '00:00:00.000'}
            </div>
            <div className="text-[9px] font-mono-tech text-cyan-500/70">
              CORE FREQ: {coreFreq.toFixed(2)} GHz // T: 312K
            </div>
          </div>
          <button
            onClick={onTestVoice}
            className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-900/50 text-[10px] font-orbitron text-cyan-300 transition-all hover:border-cyan-400"
            title="Trigger vocal diagnostics test"
          >
            <Volume2 className="w-3 h-3" />
            <span>VOICE TEST</span>
          </button>
          <button
            onClick={() => setShowVoiceModal(true)}
            className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded border border-cyan-800/60 bg-black/60 hover:bg-cyan-950/60 text-[10px] font-orbitron text-cyan-400 transition-all hover:border-cyan-500"
            title="Configure Gemini 3.8 Expressive Voice"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                geminiConfigured ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span>VOICE:</span>
            <span className="text-cyan-200 truncate max-w-[115px]">{voiceName}</span>
          </button>
          {onLockConsole && (
            <button
              onClick={onLockConsole}
              className="flex items-center space-x-1 px-2.5 py-1 rounded border border-red-500/30 bg-red-950/20 hover:bg-red-900/40 text-[10px] font-orbitron text-red-300 hover:border-red-400 transition-all"
              title="Lock console and clear session cache"
            >
              <Lock className="w-3 h-3 text-red-400" />
              <span>LOCK</span>
            </button>
          )}
        </div>
      </header>

      {/* LEFT SCI-FI TELEMETRY PANEL (DESKTOP) */}
      <aside className="absolute top-20 left-6 bottom-28 w-64 z-20 hidden lg:flex flex-col justify-between pointer-events-none">
        {/* Card 1: Acoustic Spectrum */}
        <div className="p-3.5 rounded-lg border border-cyan-900/50 bg-black/60 backdrop-blur-md pointer-events-auto shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5 text-xs font-orbitron text-cyan-400">
              <Activity className="w-3.5 h-3.5 text-cyan-300" />
              <span className="tracking-wider">SPECTRAL SENSOR</span>
            </div>
            <span className="text-[9px] font-mono-tech text-cyan-500/80">512-FFT</span>
          </div>
          <AudioSpectrumMeter bars={20} className="w-full" />
          <div className="mt-2.5 flex justify-between text-[10px] font-mono-tech text-cyan-400/80">
            <span>MIC: {isListening ? 'LIVE' : 'MUTED'}</span>
            <span>GAIN: +3.2 dB</span>
            <span>NOISE: -64 dB</span>
          </div>
        </div>

        {/* Card 2: Neural Core Specifications */}
        <div className="p-3.5 rounded-lg border border-cyan-900/50 bg-black/60 backdrop-blur-md pointer-events-auto space-y-2.5 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className="flex items-center space-x-1.5 text-xs font-orbitron text-cyan-400">
            <Cpu className="w-3.5 h-3.5 text-cyan-300" />
            <span className="tracking-wider">HEURISTIC TELEMETRY</span>
          </div>
          <div className="space-y-1.5 text-[10px] font-mono-tech text-cyan-400/80">
            <div className="flex justify-between border-b border-cyan-950 pb-1 items-center">
              <span className="text-cyan-600">VOICE ENGINE</span>
              <button
                onClick={() => setShowVoiceModal(true)}
                className="text-cyan-300 hover:text-cyan-100 hover:underline truncate max-w-[135px] text-right font-mono-tech"
                title="Click to configure Gemini 3.8 TTS"
              >
                {voiceName}
              </button>
            </div>
            <div className="flex justify-between border-b border-cyan-950 pb-1">
              <span className="text-cyan-600">GEMINI 3.8 TTS</span>
              <span className={geminiConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                {geminiConfigured ? 'ACTIVE' : 'KEY NEEDED'}
              </span>
            </div>
            <div className="flex justify-between border-b border-cyan-950 pb-1">
              <span className="text-cyan-600">n8n BRAIN</span>
              <span className="text-emerald-400">ONLINE</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cyan-600">TURN LATENCY</span>
              <span className="text-cyan-300">750ms VAD</span>
            </div>
          </div>
        </div>

        {/* Card 3: Quick Command Shortcuts */}
        <div className="p-3 rounded-lg border border-cyan-900/40 bg-black/40 backdrop-blur-sm pointer-events-auto">
          <div className="text-[10px] font-orbitron text-cyan-400/90 mb-1.5 flex items-center space-x-1">
            <Terminal className="w-3 h-3 text-cyan-400" />
            <span>OPERATIONAL HOTKEYS</span>
          </div>
          <div className="text-[9px] font-mono-tech text-cyan-500/70 space-y-1">
            <p>
              <strong className="text-cyan-300">["HEY JARVIS"]</strong> Voice Wake Trigger
            </p>
            <p>
              <strong className="text-cyan-300">[OPTION + SPACE]</strong> Quick Talk Hotkey
            </p>
            <p>
              <strong className="text-cyan-300">[CMD+SHIFT+J]</strong> Global Voice Toggle
            </p>
            <p>
              <strong className="text-cyan-300">[SPACEBAR]</strong> Push-To-Talk Toggle
            </p>
            <p>
              <strong className="text-cyan-300">[CLICK CORE]</strong> Engage / Disengage
            </p>
          </div>
        </div>
      </aside>

      {/* RIGHT SCI-FI TELEMETRY PANEL (DESKTOP) */}
      <aside className="absolute top-20 right-6 bottom-28 w-64 z-20 hidden lg:flex flex-col justify-between pointer-events-none">
        {/* Subsystems Matrix */}
        <div className="p-3.5 rounded-lg border border-cyan-900/50 bg-black/60 backdrop-blur-md pointer-events-auto space-y-2 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className="flex items-center justify-between text-xs font-orbitron text-cyan-400">
            <div className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-300" />
              <span className="tracking-wider">SUBSYSTEMS</span>
            </div>
            <span className="text-[9px] font-mono-tech text-emerald-400">OPTIMAL</span>
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'ARC-REACTOR OUTPUT', value: '100%', color: 'bg-cyan-500' },
              {
                label: 'GEMINI 3.8 VOICE',
                value: geminiConfigured ? 'ONLINE' : 'STANDBY',
                color: geminiConfigured ? 'bg-emerald-500' : 'bg-amber-500',
              },
              {
                label: 'STT STREAM CAPTURE',
                value: isListening ? 'ACTIVE' : 'IDLE',
                color: isListening ? 'bg-cyan-400' : 'bg-blue-600',
              },
              {
                label: 'SPEECH SYNTHESIS',
                value: state === 'speaking' ? 'VOCALIZING' : 'ARMED',
                color: state === 'speaking' ? 'bg-emerald-400' : 'bg-cyan-600',
              },
            ].map((item, idx) => (
              <div key={idx} className="text-[10px] font-mono-tech">
                <div className="flex justify-between text-cyan-400/90 mb-0.5">
                  <span className="text-[9px] text-cyan-500">{item.label}</span>
                  <span className="text-cyan-200">{item.value}</span>
                </div>
                <div className="w-full bg-cyan-950/80 rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all duration-300`}
                    style={{ width: '90%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transmission Statistics */}
        <div className="p-3.5 rounded-lg border border-cyan-900/50 bg-black/60 backdrop-blur-md pointer-events-auto space-y-2 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className="flex items-center justify-between text-xs font-orbitron text-cyan-400">
            <div className="flex items-center space-x-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-300" />
              <span className="tracking-wider">TRANSMISSIONS</span>
            </div>
            <span className="text-[9px] font-mono-tech text-cyan-400">{historyLength} LOGS</span>
          </div>
          <div className="text-[10px] font-mono-tech text-cyan-400/80 space-y-1">
            <div className="flex justify-between">
              <span className="text-cyan-600">SESSION TARGET</span>
              <span className="text-cyan-300">jarvis-web</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cyan-600">AUDIO FORMAT</span>
              <span className="text-emerald-400">24kHz PCM WAV</span>
            </div>
            {historyLength > 0 && onClearHistory && (
              <button
                onClick={onClearHistory}
                className="w-full mt-2 py-1 text-[9px] font-orbitron text-cyan-400 border border-cyan-900/70 hover:border-cyan-500 bg-cyan-950/30 rounded transition-colors"
              >
                PURGE LOG BUFFER
              </button>
            )}
          </div>
        </div>

        {/* Security / Protocol Indicator */}
        <div className="p-2.5 rounded-lg border border-cyan-900/40 bg-black/40 text-[9px] font-mono-tech text-cyan-500/70 flex items-center space-x-2">
          <ShieldAlert className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>ENCRYPTED NEURAL PIPELINE // AUTHORIZATION LEVEL 5</span>
        </div>
      </aside>

      {/* GEMINI 3.8 VOICE DESIGN & SELECTION MODAL */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="relative w-full max-w-xl p-6 rounded-2xl border border-cyan-500/60 bg-black/95 shadow-[0_0_50px_rgba(0,240,255,0.25)] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-cyan-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <Volume2 className="w-5 h-5 text-cyan-400" />
                <h2 className="font-orbitron font-bold text-sm tracking-widest text-cyan-300">
                  GEMINI 3.8 EXPRESSIVE VOICE SYNTHESIZER
                </h2>
              </div>
              <button
                onClick={() => setShowVoiceModal(false)}
                className="text-cyan-500 hover:text-cyan-300 text-xs font-mono-tech px-2 py-1 rounded border border-cyan-900 hover:border-cyan-500"
              >
                [ESC / CLOSE]
              </button>
            </div>

            {/* Gemini API Key Status & Quick Input */}
            <div className="p-3.5 rounded-xl border border-cyan-800/60 bg-cyan-950/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-orbitron text-cyan-200">
                  <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
                  <span>GEMINI 3.8 TTS ENGINE STATUS</span>
                </div>
                <span
                  className={`flex items-center space-x-1 text-[10px] font-mono-tech px-2 py-0.5 rounded border ${
                    geminiConfigured
                      ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-300'
                      : 'border-amber-500/60 bg-amber-950/50 text-amber-300'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>
                    {geminiConfigured ? 'GEMINI 3.8 ONLINE' : 'USING EDGE FALLBACK (NO KEY)'}
                  </span>
                </span>
              </div>

              <p className="text-[11px] font-mono-tech text-cyan-400/80">
                Set <code className="text-cyan-200">GEMINI_API_KEY</code> in Vercel Environment Variables, or paste your Google AI Studio key below to activate immediately:
              </p>

              <div className="flex items-center space-x-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy... (Optional if GEMINI_API_KEY is set in Vercel)"
                  className="flex-1 bg-black/80 border border-cyan-800 focus:border-cyan-400 rounded-lg px-3 py-1.5 text-xs font-mono-tech text-cyan-100 placeholder-cyan-700 outline-none"
                />
                <button
                  onClick={handleSaveApiKey}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400 hover:bg-cyan-500/30 text-xs font-orbitron text-cyan-200 transition-colors shrink-0"
                >
                  SAVE KEY
                </button>
              </div>

              {/* One-Click Custom Voice Design Generator */}
              <div className="flex items-center justify-between pt-1 border-t border-cyan-900/50">
                <div className="text-[10px] font-mono-tech text-cyan-400">
                  {customVoiceId ? (
                    <span>
                      Custom Designed Persona ID:{' '}
                      <strong className="text-emerald-300">{customVoiceId}</strong>
                    </span>
                  ) : (
                    <span>Auto-creates persistent British Jarvis persona on first synthesis</span>
                  )}
                </div>
                <button
                  onClick={handleGenerateCustomVoice}
                  disabled={isDesigningVoice}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded border border-cyan-600/60 bg-cyan-950/50 hover:bg-cyan-900/60 text-[10px] font-orbitron text-cyan-200 disabled:opacity-50 transition-colors"
                >
                  {isDesigningVoice ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wand2 className="w-3 h-3 text-cyan-300" />
                  )}
                  <span>{customVoiceId ? 'RE-DESIGN PERSONA' : 'DESIGN JARVIS VOICE'}</span>
                </button>
              </div>

              {designStatusMsg && (
                <div className="text-[10px] font-mono-tech text-cyan-300 bg-black/60 px-2.5 py-1 rounded border border-cyan-900">
                  {designStatusMsg}
                </div>
              )}
            </div>

            {/* Voice Presets List */}
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {JARVIS_NEURAL_VOICES.map((preset) => {
                const isCurrent = preset.id === activeVoicePresetId;
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      onSelectVoicePreset?.(preset);
                    }}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isCurrent
                        ? 'border-cyan-400 bg-cyan-950/60 text-white shadow-[0_0_16px_rgba(0,240,255,0.28)]'
                        : 'border-cyan-950/80 bg-black/50 hover:border-cyan-700 hover:bg-cyan-950/30 text-cyan-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3 pr-3">
                      <span
                        className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
                          isCurrent ? 'bg-cyan-400 animate-ping' : 'bg-cyan-800'
                        }`}
                      />
                      <div className="space-y-0.5">
                        <div className="text-xs font-orbitron font-bold text-cyan-200">
                          {preset.name}
                        </div>
                        <div className="text-[10px] font-mono-tech text-cyan-400">
                          {preset.accent} • Model: {preset.model}
                        </div>
                        <div className="text-[11px] font-sans text-cyan-500/90">
                          {preset.description}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-orbitron px-2.5 py-1 rounded border shrink-0 ${
                        isCurrent
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                          : 'border-cyan-800 text-cyan-400'
                      }`}
                    >
                      {isCurrent ? 'ACTIVE' : 'ENGAGE'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end space-x-3">
              <button
                onClick={onTestVoice}
                className="px-3.5 py-1.5 rounded border border-cyan-500/60 bg-cyan-950/50 hover:bg-cyan-900/60 text-xs font-orbitron text-cyan-300 transition-colors"
              >
                TEST VOICE SAMPLE
              </button>
              <button
                onClick={() => setShowVoiceModal(false)}
                className="px-4 py-1.5 rounded bg-cyan-500 text-black hover:bg-cyan-400 text-xs font-orbitron font-bold transition-colors"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
