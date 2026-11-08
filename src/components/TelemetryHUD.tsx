import React, { useState, useEffect } from 'react';
import { NotificationSettings } from './NotificationSettings';
import {
  LayoutGrid,
  Cpu,
  Terminal,
  Volume2,
  Activity,
  Sparkles,
  Lock,
  Ear,
  KeyRound,
  CheckCircle2,
  Wand2,
  Loader2,
  X,
  Fingerprint,
  Settings2,
} from 'lucide-react';
import {
  JarvisAudioState,
  JARVIS_NEURAL_VOICES,
  JarvisNeuralVoicePreset,
  audioEngine,
} from '../services/audioEngine';
import { AudioSpectrumMeter } from './AudioSpectrumMeter';
import { BatteryStatus } from '../hooks/useBatteryStatus';
import { VoiceBiometricsModal } from './VoiceBiometricsModal';
import { VoiceLab } from './VoiceLab';

export type WakeWordMode = 'charging_only' | 'always' | 'off';
export type WakeWordScope = 'background' | 'active_only';

interface TelemetryHUDProps {
  state: JarvisAudioState;
  isListening: boolean;
  isWakeWordActive: boolean;
  wakeWordMode: WakeWordMode;
  wakeWordScope?: WakeWordScope;
  battery: BatteryStatus;
  voiceName: string;
  activeVoicePresetId: string;
  activeSpeakerName?: string;
  onTestVoice?: () => void;
  onPreviewVoice?: (text: string) => void;
  onLockConsole?: () => void;
  onToggleWakeWordMode?: () => void;
  onToggleWakeWordScope?: () => void;
  onSelectVoicePreset?: (preset: JarvisNeuralVoicePreset) => void;
}

export const TelemetryHUD: React.FC<TelemetryHUDProps> = ({
  state,
  isListening,
  isWakeWordActive,
  wakeWordMode,
  wakeWordScope = 'background',
  battery,
  voiceName,
  activeVoicePresetId,
  activeSpeakerName,
  onTestVoice,
  onPreviewVoice,
  onLockConsole,
  onToggleWakeWordMode,
  onToggleWakeWordScope,
  onSelectVoicePreset,
}) => {
  const coreFreq = 4.80;
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showMobileHudDrawer, setShowMobileHudDrawer] = useState(false);
  const [showBiometricsModal, setShowBiometricsModal] = useState(false);

  // Gemini 3.8 TTS status & custom voice design states
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => audioEngine.getClientGeminiApiKey());
  const [customVoiceId, setCustomVoiceId] = useState<string>(() =>
    audioEngine.getCustomDesignedVoiceId()
  );
  const [isDesigningVoice, setIsDesigningVoice] = useState<boolean>(false);
  const [designStatusMsg, setDesignStatusMsg] = useState<string>('');

  // Other parts of the HUD (the system card) can open the voice / voice ID panels
  useEffect(() => {
    const openVoice = () => setShowVoiceModal(true);
    const openVoiceId = () => setShowBiometricsModal(true);
    window.addEventListener('jarvis:open-voice', openVoice);
    window.addEventListener('jarvis:open-voice-id', openVoiceId);
    return () => {
      window.removeEventListener('jarvis:open-voice', openVoice);
      window.removeEventListener('jarvis:open-voice-id', openVoiceId);
    };
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


  return (
    <>
      {/* TOP SCI-FI STATUS BAR */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent pt-safe">
        {/* Left: Branding & Core ID */}
        <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded border border-amber-500/60 flex items-center justify-center bg-amber-950/30 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)] shrink-0">
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <span className="max-[479px]:hidden font-orbitron font-bold text-xs sm:text-sm tracking-[0.2em] sm:tracking-[0.25em] text-amber-300 text-glow-amber">
                  J.A.R.V.I.S.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Telemetry Clock, Mobile HUD Toggle, Voice & Lock Actions */}
        <div className="flex items-center space-x-1.5 lg:space-x-3 shrink-0">
          {/* Layout mode: move / resize / hide widgets */}
          <button
            onClick={() => window.dispatchEvent(new Event('jarvis:edit-layout'))}
            className="flex items-center space-x-1 px-2.5 py-2 lg:py-1 rounded border border-amber-800/60 bg-black/60 hover:bg-amber-950/60 text-[10px] font-orbitron text-amber-400 transition-all hover:border-amber-500"
            title="Arrange widgets: move, resize, hide"
            aria-label="Arrange widgets"
          >
            <LayoutGrid className="w-3 h-3 text-amber-300" />
            <span className="hidden lg:inline">LAYOUT</span>
          </button>

          {/* Mobile HUD System Diagnostics Drawer Trigger */}
          <button
            onClick={() => setShowMobileHudDrawer(true)}
            className="flex items-center space-x-1 px-2.5 py-2 lg:py-1 rounded border border-amber-800/60 bg-black/60 hover:bg-amber-950/60 text-[10px] font-orbitron text-amber-400 transition-all hover:border-amber-500"
            title="Settings: wake word, listening and system details"
          >
            <Settings2 className="w-3 h-3 text-amber-300" />
            <span className="hidden lg:inline">SETTINGS</span>
          </button>

          {/* Voice Configuration Trigger */}
          <button
            onClick={() => setShowVoiceModal(true)}
            className="flex items-center space-x-1 sm:space-x-1.5 px-2.5 py-2 lg:py-1 rounded border border-amber-800/60 bg-black/60 hover:bg-amber-950/60 text-[10px] font-orbitron text-amber-400 transition-all hover:border-amber-500"
            title="Configure Gemini 3.8 Expressive Voice"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                geminiConfigured ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <Volume2 className="w-3 h-3 lg:hidden text-amber-300" />
            <span className="hidden lg:inline">VOICE:</span>
            <span className="text-amber-200 truncate max-w-[150px] hidden lg:inline">{voiceName}</span>
          </button>

          {/* Biometric Voice ID Trigger */}
          <button
            onClick={() => setShowBiometricsModal(true)}
            className="flex items-center space-x-1 sm:space-x-1.5 px-2.5 py-2 lg:py-1 rounded border border-amber-800/60 bg-black/60 hover:bg-amber-950/60 text-[10px] font-orbitron text-amber-400 transition-all hover:border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
            title="Biometric Voiceprints & Speaker Identification"
          >
            <Fingerprint className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-300" />
            <span className="hidden lg:inline">VOICE ID:</span>
            <span className="hidden sm:inline text-amber-200 truncate max-w-[95px]">{activeSpeakerName || 'PROFILE'}</span>
          </button>

          {/* Voice Test Action (Desktop & Tablet) */}
          <button
            onClick={onTestVoice}
            className="hidden lg:flex items-center space-x-1 px-2.5 py-1 rounded border border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/50 text-[10px] font-orbitron text-amber-300 transition-all hover:border-amber-400"
            title="Trigger vocal diagnostics test"
          >
            <Volume2 className="w-3 h-3" />
            <span>TEST</span>
          </button>

          {/* Lock Console Action */}
          {onLockConsole && (
            <button
              onClick={onLockConsole}
              className="flex items-center space-x-1 px-2.5 py-2 lg:py-1 rounded border border-red-500/30 bg-red-950/20 hover:bg-red-900/40 text-[10px] font-orbitron text-red-300 hover:border-red-400 transition-all"
              title="Lock console and clear session cache"
            >
              <Lock className="w-3 h-3 text-red-400" />
              <span className="hidden lg:inline">LOCK</span>
            </button>
          )}
        </div>
      </header>

      {/* MOBILE TELEMETRY & SYSTEM DRAWER */}
      {showMobileHudDrawer && (
        <aside className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-2xl p-4 sm:p-6 overflow-y-auto pt-safe pb-safe animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-amber-900/80 pb-3 mb-4">
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-amber-400 animate-pulse" />
              <div>
                <h3 className="font-orbitron font-bold text-xs tracking-widest text-amber-200">
                  SYSTEM TELEMETRY & DIAGNOSTICS
                </h3>
                <p className="text-[9px] font-mono-tech text-amber-500/80">
                  MARK-VII MOBILE HUD PROTOCOL // LEVEL 5
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowMobileHudDrawer(false)}
              className="p-1.5 rounded-lg border border-amber-800 text-amber-400 hover:text-white"
              title="Close System HUD"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4 font-mono-tech max-w-lg mx-auto w-full">
            {/* Spectral Sensor */}
            <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>ACOUSTIC SPECTRAL SENSOR</span>
                </div>
                <span className="text-[9px] text-amber-500">512-FFT</span>
              </div>
              <AudioSpectrumMeter bars={20} className="w-full" />
              <div className="mt-2 flex justify-between text-[10px] text-amber-400/80">
                <span>MIC: {isListening ? 'LIVE' : 'MUTED'}</span>
                <span>STATE: {state.toUpperCase()}</span>
                <span>GAIN: +3.2 dB</span>
              </div>
            </div>

            {/* Wake Word Power Profile */}
            <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
                  <Ear className="w-3.5 h-3.5 text-amber-400" />
                  <span>WAKE-WORD PROFILE</span>
                </div>
                <span
                  className={`text-[10px] font-orbitron px-2 py-0.5 rounded border ${
                    isWakeWordActive
                      ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/40'
                      : 'border-amber-900 text-amber-500'
                  }`}
                >
                  {isWakeWordActive ? 'ACTIVE' : 'IDLE'}
                </span>
              </div>
              <p className="text-[10px] text-amber-500/80">
                Say "Hey Jarvis" or "Jarvis" to trigger vocal activation hands-free.
              </p>
              <div className="space-y-2">
                {onToggleWakeWordMode && (
                  <button
                    onClick={onToggleWakeWordMode}
                    className="w-full py-2.5 px-3 rounded-lg border border-amber-500/50 bg-amber-950/40 hover:bg-amber-900/50 text-xs font-orbitron text-amber-200 flex items-center justify-between transition-colors"
                  >
                    <span className="text-[10px] text-amber-400">POWER MODE:</span>
                    <span className="text-amber-200 text-xs">
                      {wakeWordMode === 'charging_only'
                        ? battery.charging
                          ? 'ON POWER (CHARGING ACTIVE)'
                          : 'ON POWER (PAUSED ON BATTERY)'
                        : wakeWordMode === 'always'
                        ? 'ALWAYS ON'
                        : 'DISABLED'}
                    </span>
                  </button>
                )}
                {onToggleWakeWordScope && (
                  <button
                    onClick={onToggleWakeWordScope}
                    className="w-full py-2.5 px-3 rounded-lg border border-amber-700/60 bg-black/60 hover:bg-amber-950/40 text-xs font-orbitron text-amber-200 flex items-center justify-between transition-colors"
                  >
                    <span className="text-[10px] text-amber-400">SCOPE:</span>
                    <span className="text-amber-200 text-xs">
                      {wakeWordScope === 'background'
                        ? 'BACKGROUND & ACTIVE'
                        : 'ACTIVE TAB ONLY (PAUSE IN BG)'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Install as an app + push notifications */}
            <NotificationSettings />

            {/* Biometric Voice ID Configuration (Mobile) */}
            <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
                  <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
                  <span>BIOMETRIC SPEAKER ID</span>
                </div>
                <span className="text-[10px] font-mono-tech text-amber-300 px-2 py-0.5 rounded border border-amber-800">
                  {activeSpeakerName || 'ENROLLED'}
                </span>
              </div>
              <p className="text-[10px] text-amber-500/80">
                Acoustic formant vectors & fundamental pitch (F₀) calibration.
              </p>
              <button
                onClick={() => {
                  setShowMobileHudDrawer(false);
                  setShowBiometricsModal(true);
                }}
                className="w-full py-2 px-3 rounded-lg border border-amber-500/60 bg-amber-950/40 text-xs font-orbitron text-amber-200 flex items-center justify-center space-x-2"
              >
                <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
                <span>CONFIGURE VOICEPRINTS</span>
              </button>
            </div>

            {/* Voice Engine & Test */}
            <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
                  <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>VOICE SYNTHESIS ENGINE</span>
                </div>
                <span className="text-[10px] text-amber-300 truncate max-w-[140px]">{voiceName}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setShowMobileHudDrawer(false);
                    setShowVoiceModal(true);
                  }}
                  className="py-2.5 px-2 rounded-lg border border-amber-700/60 bg-amber-950/40 hover:bg-amber-900/60 text-[10px] font-orbitron text-amber-200 text-center transition-colors"
                >
                  SELECT VOICE
                </button>
                <button
                  onClick={onTestVoice}
                  className="py-2.5 px-2 rounded-lg border border-amber-500/60 bg-amber-950/40 hover:bg-amber-900/60 text-[10px] font-orbitron text-amber-300 text-center transition-colors"
                >
                  VOICE TEST
                </button>
              </div>
            </div>

            {/* Subsystems & Hardware Telemetry */}
            <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2 text-[10px]">
              <div className="flex items-center justify-between text-xs font-orbitron text-amber-300 mb-1">
                <div className="flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                  <span>SUBSYSTEMS & HARDWARE</span>
                </div>
                <span className="text-emerald-400">OPTIMAL</span>
              </div>
              <div className="flex justify-between border-b border-amber-950 pb-1">
                <span className="text-amber-600">BATTERY</span>
                <span className="text-amber-200">
                  {battery.charging ? '⚡ CHARGING ' : ''}{Math.round(battery.level * 100)}%
                </span>
              </div>
              <div className="flex justify-between border-b border-amber-950 pb-1">
                <span className="text-amber-600">CORE FREQUENCY</span>
                <span className="text-amber-200">{coreFreq.toFixed(2)} GHz</span>
              </div>
              <div className="flex justify-between border-b border-amber-950 pb-1">
                <span className="text-amber-600">n8n NEURAL LINK</span>
                <span className="text-emerald-400">ONLINE</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-600">AUDIO FORMAT</span>
                <span className="text-emerald-400">24kHz PCM WAV</span>
              </div>
            </div>

            {/* Mobile Interaction Guide */}
            <div className="p-3 rounded-xl border border-amber-900/40 bg-black/40 text-[10px] space-y-1.5 text-amber-500/80">
              <div className="text-xs font-orbitron text-amber-300 mb-1 flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span>MOBILE TOUCH GUIDE</span>
              </div>
              <p>• <strong className="text-amber-300">Tap Arc Reactor</strong> to speak or interrupt</p>
              <p>• <strong className="text-amber-300">Touch & drag</strong> anywhere to rotate 3D reactor in real time</p>
              <p>• <strong className="text-amber-300">Tap to Talk</strong> button at screen bottom</p>
              <p>• <strong className="text-amber-300">Terminal icon</strong> opens text command override</p>
            </div>
          </div>
        </aside>
      )}

      {/* GEMINI 3.8 VOICE DESIGN & SELECTION MODAL */}
      {showVoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 pt-safe pb-safe">
          <div className="relative w-full max-w-xl p-4 sm:p-6 rounded-2xl border border-amber-500/60 bg-black/95 shadow-[0_0_50px_rgba(245,158,11,0.25)] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-amber-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <Volume2 className="w-5 h-5 text-amber-400" />
                <h2 className="font-orbitron font-bold text-xs sm:text-sm tracking-widest text-amber-300">
                  GEMINI 3.8 EXPRESSIVE VOICE
                </h2>
              </div>
              <button
                onClick={() => setShowVoiceModal(false)}
                className="text-amber-500 hover:text-amber-300 text-xs font-mono-tech px-2 py-1 rounded border border-amber-900 hover:border-amber-500"
              >
                [CLOSE]
              </button>
            </div>

            {/* Gemini API Key Status & Quick Input */}
            <div className="p-3 sm:p-3.5 rounded-xl border border-amber-800/60 bg-amber-950/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-orbitron text-amber-200">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>GEMINI 3.8 TTS STATUS</span>
                </div>
                <span
                  className={`flex items-center space-x-1 text-[9px] sm:text-[10px] font-mono-tech px-2 py-0.5 rounded border ${
                    geminiConfigured
                      ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-300'
                      : 'border-amber-500/60 bg-amber-950/50 text-amber-300'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>
                    {geminiConfigured ? 'GEMINI ONLINE' : 'EDGE FALLBACK'}
                  </span>
                </span>
              </div>

              <p className="text-[10px] sm:text-[11px] font-mono-tech text-amber-400/80">
                Set <code className="text-amber-200">GEMINI_API_KEY</code> in Vercel, or paste your Google AI Studio key below:
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy... (Google AI Studio Key)"
                  className="flex-1 bg-black/80 border border-amber-800 focus:border-amber-400 rounded-lg px-3 py-1.5 text-xs font-mono-tech text-amber-100 placeholder-cyan-700 outline-none"
                />
                <button
                  onClick={handleSaveApiKey}
                  className="px-3 py-2 sm:py-1.5 rounded-lg bg-amber-500/20 border border-amber-400 hover:bg-amber-500/30 text-xs font-orbitron text-amber-200 transition-colors shrink-0 text-center"
                >
                  SAVE KEY
                </button>
              </div>

              {/* One-Click Custom Voice Design Generator */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-amber-900/50">
                <div className="text-[10px] font-mono-tech text-amber-400">
                  {customVoiceId ? (
                    <span>
                      Persona ID: <strong className="text-emerald-300">{customVoiceId}</strong>
                    </span>
                  ) : (
                    <span>Auto-creates British Jarvis persona</span>
                  )}
                </div>
                <button
                  onClick={handleGenerateCustomVoice}
                  disabled={isDesigningVoice}
                  className="flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded border border-amber-600/60 bg-amber-950/50 hover:bg-amber-900/60 text-[10px] font-orbitron text-amber-200 disabled:opacity-50 transition-colors"
                >
                  {isDesigningVoice ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wand2 className="w-3 h-3 text-amber-300" />
                  )}
                  <span>{customVoiceId ? 'RE-DESIGN PERSONA' : 'DESIGN JARVIS VOICE'}</span>
                </button>
              </div>

              {designStatusMsg && (
                <div className="text-[10px] font-mono-tech text-amber-300 bg-black/60 px-2.5 py-1 rounded border border-amber-900">
                  {designStatusMsg}
                </div>
              )}
            </div>

            {/* Side-by-side provider comparison (separate page; doesn't touch the live voice) */}
            <a
              href="#/voice-compare"
              onClick={() => setShowVoiceModal(false)}
              className="flex items-center justify-between p-3 rounded-xl border border-amber-700/70 bg-black/50 hover:border-amber-400 text-xs font-orbitron text-amber-200"
            >
              <span>COMPARE TTS PROVIDERS BY EAR</span>
              <span className="text-amber-400">→</span>
            </a>

            {/* Voice Lab: remix voice identity, delivery direction, and EQ polish */}
            <VoiceLab
              onPreview={(text) => onPreviewVoice?.(text)}
              onVoiceChanged={(id) => setCustomVoiceId(id)}
            />

            {/* Voice Presets List */}
            <div className="max-h-60 sm:max-h-64 overflow-y-auto space-y-2 pr-1">
              {JARVIS_NEURAL_VOICES.map((preset) => {
                const isCurrent = preset.id === activeVoicePresetId;
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      onSelectVoicePreset?.(preset);
                    }}
                    className={`flex items-center justify-between p-2.5 sm:p-3 rounded-xl border cursor-pointer transition-all ${
                      isCurrent
                        ? 'border-amber-400 bg-amber-950/60 text-white shadow-[0_0_16px_rgba(245,158,11,0.28)]'
                        : 'border-amber-950/80 bg-black/50 hover:border-amber-700 hover:bg-amber-950/30 text-amber-300'
                    }`}
                  >
                    <div className="flex items-start space-x-2.5 sm:space-x-3 pr-2">
                      <span
                        className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full mt-1 shrink-0 ${
                          isCurrent ? 'bg-amber-400 animate-ping' : 'bg-amber-800'
                        }`}
                      />
                      <div className="space-y-0.5">
                        <div className="text-xs font-orbitron font-bold text-amber-200">
                          {preset.name}
                        </div>
                        <div className="text-[9px] sm:text-[10px] font-mono-tech text-amber-400">
                          {preset.accent} • Model: {preset.model}
                        </div>
                        <div className="text-[10px] sm:text-[11px] font-sans text-amber-500/90 leading-tight">
                          {preset.description}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[9px] sm:text-[10px] font-orbitron px-2 sm:px-2.5 py-1 rounded border shrink-0 ${
                        isCurrent
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-amber-800 text-amber-400'
                      }`}
                    >
                      {isCurrent ? 'ACTIVE' : 'ENGAGE'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end space-x-2 sm:space-x-3">
              <button
                onClick={onTestVoice}
                className="px-3 py-1.5 rounded border border-amber-500/60 bg-amber-950/50 hover:bg-amber-900/60 text-xs font-orbitron text-amber-300 transition-colors"
              >
                TEST SAMPLE
              </button>
              <button
                onClick={() => setShowVoiceModal(false)}
                className="px-4 py-1.5 rounded bg-amber-500 text-black hover:bg-amber-400 text-xs font-orbitron font-bold transition-colors"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Biometric Voice ID & Speaker Profiles Modal */}
      <VoiceBiometricsModal
        isOpen={showBiometricsModal}
        onClose={() => setShowBiometricsModal(false)}
      />
    </>
  );
};
