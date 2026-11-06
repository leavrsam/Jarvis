import React, { useState, useEffect, useRef } from 'react';
import { 
  Fingerprint, 
  ShieldCheck, 
  ShieldAlert, 
  Mic, 
  Trash2, 
  X, 
  CheckCircle2, 
  User, 
  UserPlus, 
  Activity, 
  Loader2 
} from 'lucide-react';
import { 
  voiceBiometrics, 
  VoiceProfile 
} from '../services/voiceBiometrics';
import { audioEngine } from '../services/audioEngine';

interface VoiceBiometricsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileChanged?: () => void;
}

export const VoiceBiometricsModal: React.FC<VoiceBiometricsModalProps> = ({
  isOpen,
  onClose,
  onProfileChanged,
}) => {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [ownerGateEnabled, setOwnerGateEnabled] = useState(false);
  const [newName, setNewName] = useState('Samuel');
  const [isOwner, setIsOwner] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [liveVolume, setLiveVolume] = useState(0);

  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setProfiles(voiceBiometrics.getProfiles());
      setOwnerGateEnabled(voiceBiometrics.isOwnerGateEnabled());
      setEnrollStatus(null);
      setEnrollProgress(0);
    }
  }, [isOpen]);

  const handleToggleGate = () => {
    const next = !ownerGateEnabled;
    setOwnerGateEnabled(next);
    voiceBiometrics.setOwnerGateEnabled(next);
  };

  const handleDelete = (id: string) => {
    voiceBiometrics.deleteProfile(id);
    const updated = voiceBiometrics.getProfiles();
    setProfiles(updated);
    onProfileChanged?.();
  };

  const handleStartEnrollment = async () => {
    if (!newName.trim()) return;

    setIsEnrolling(true);
    setEnrollProgress(0);
    setEnrollStatus('Initializing acoustic sensor... Please prepare to speak.');
    audioEngine.playSfx('activate');

    await audioEngine.startMicListening();
    voiceBiometrics.startUtteranceCapture();

    // Volume monitoring loop
    const monitorLoop = () => {
      const telemetry = audioEngine.getAudioTelemetry();
      setLiveVolume(telemetry.volume);
      animFrameRef.current = requestAnimationFrame(monitorLoop);
    };
    monitorLoop();

    const totalSeconds = 5;
    let elapsedMs = 0;
    const intervalMs = 100;

    countdownTimerRef.current = setInterval(() => {
      elapsedMs += intervalMs;
      const pct = Math.min(100, Math.round((elapsedMs / (totalSeconds * 1000)) * 100));
      setEnrollProgress(pct);

      const remainingSecs = Math.max(0, Math.ceil((totalSeconds * 1000 - elapsedMs) / 1000));
      setEnrollStatus(`Recording vocal formants... (${remainingSecs}s remaining). Read the phrase above.`);

      if (elapsedMs >= totalSeconds * 1000) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

        try {
          const profile = voiceBiometrics.enrollProfile(newName.trim(), isOwner);
          setProfiles(voiceBiometrics.getProfiles());
          audioEngine.playSfx('response');
          setEnrollStatus(
            `Enrollment Complete! Calibrated vocal signature for "${profile.name}" (F₀: ${profile.avgPitchHz} Hz).`
          );
          onProfileChanged?.();
        } catch (err) {
          audioEngine.playSfx('error');
          setEnrollStatus(`Enrollment Failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setIsEnrolling(false);
          setLiveVolume(0);
          audioEngine.stopMicListening();
        }
      }
    }, intervalMs);
  };

  const handleCancelEnrollment = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsEnrolling(false);
    setEnrollProgress(0);
    setLiveVolume(0);
    setEnrollStatus('Enrollment cancelled.');
    audioEngine.stopMicListening();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-xl bg-[#030914] border border-cyan-500/50 rounded-lg shadow-[0_0_40px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Holographic Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-900/60 bg-gradient-to-r from-cyan-950/40 via-blue-950/20 to-black">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded border border-cyan-500/60 bg-cyan-950/40 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.4)]">
              <Fingerprint className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-sm tracking-widest text-cyan-200">
                VOICE BIOMETRICS // SPEAKER ID
              </h2>
              <p className="text-[10px] font-mono-tech text-cyan-400/70">
                Acoustic Formant Vector & Fundamental Pitch (F₀) Recognition
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-cyan-400/60 hover:text-cyan-200 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Security Gate Mode Toggle */}
          <div className="flex items-center justify-between p-3 rounded border border-cyan-900/60 bg-black/40">
            <div className="flex items-center space-x-3">
              {ownerGateEnabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-400" />
              )}
              <div>
                <div className="font-orbitron text-xs text-cyan-200 tracking-wider">
                  OWNER-ONLY AUTHORIZATION GATE
                </div>
                <div className="text-[10px] font-mono-tech text-cyan-400/60">
                  Tag unauthorized or unrecognized speakers as guests in n8n transmissions
                </div>
              </div>
            </div>
            <button
              onClick={handleToggleGate}
              className={`px-3 py-1 rounded text-xs font-mono-tech border transition-all ${
                ownerGateEnabled
                  ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : 'bg-black/60 border-cyan-900/60 text-cyan-500'
              }`}
            >
              {ownerGateEnabled ? 'GATE ARMED' : 'GATE OFF'}
            </button>
          </div>

          {/* Enrolled Profiles List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-orbitron text-cyan-300 tracking-wider">
              <span>ENROLLED PROFILES ({profiles.length})</span>
            </div>

            {profiles.length === 0 ? (
              <div className="p-4 rounded border border-dashed border-cyan-900/60 text-center text-xs font-mono-tech text-cyan-500/70">
                No voiceprints registered yet. Calibrate below to register Samuel.
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 rounded border border-cyan-950/80 bg-cyan-950/20 hover:border-cyan-800 transition-all"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div className="w-7 h-7 rounded-full border border-cyan-500/40 flex items-center justify-center bg-black/60">
                        <User className="w-3.5 h-3.5 text-cyan-300" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-orbitron text-xs text-cyan-200">{p.name}</span>
                          {p.isOwner && (
                            <span className="px-1.5 py-0.2 rounded bg-cyan-900/60 border border-cyan-500/60 text-[9px] font-mono-tech text-cyan-300">
                              PRIMARY OWNER
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono-tech text-cyan-400/60">
                          F₀ Pitch: ~{p.avgPitchHz} Hz • {p.samplesCount} acoustic vectors stored
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-red-400/60 hover:text-red-300 p-1.5 rounded hover:bg-red-950/40 transition-all"
                      title="Delete profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* New Voice Enrollment Wizard */}
          <div className="p-4 rounded border border-cyan-900/60 bg-black/50 space-y-4">
            <div className="flex items-center space-x-2 text-xs font-orbitron text-cyan-300 tracking-wider">
              <UserPlus className="w-4 h-4 text-cyan-400" />
              <span>ENROLL NEW VOICEPRINT</span>
            </div>

            {/* Phrase to read */}
            <div className="p-3 rounded border border-cyan-950 bg-cyan-950/20 text-center">
              <span className="text-[10px] font-mono-tech text-cyan-400/70 block mb-1">
                CALIBRATION SCRIPT (READ ALOUD):
              </span>
              <p className="text-xs font-mono-tech text-cyan-200 italic font-semibold">
                "Jarvis, verify authorization and calibrate my voice signature."
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono-tech text-cyan-400/70 block mb-1">
                  SPEAKER NAME
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isEnrolling}
                  placeholder="e.g. Samuel"
                  className="w-full px-3 py-1.5 rounded bg-black/60 border border-cyan-800 text-cyan-200 text-xs font-mono-tech focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                />
              </div>

              <div className="flex items-end pb-1.5">
                <label className="flex items-center space-x-2 cursor-pointer text-xs font-mono-tech text-cyan-300">
                  <input
                    type="checkbox"
                    checked={isOwner}
                    onChange={(e) => setIsOwner(e.target.checked)}
                    disabled={isEnrolling}
                    className="rounded border-cyan-800 bg-black text-cyan-500 focus:ring-0"
                  />
                  <span>Designate as Primary Owner</span>
                </label>
              </div>
            </div>

            {/* Recording Progress & Volume Meter */}
            {isEnrolling && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-[10px] font-mono-tech text-cyan-300">
                  <span>CALIBRATION PROGRESS: {enrollProgress}%</span>
                  <span className="flex items-center space-x-1">
                    <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                    <span>MIC ENERGY</span>
                  </span>
                </div>

                <div className="w-full h-2 rounded bg-black/60 border border-cyan-950 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-100"
                    style={{ width: `${enrollProgress}%` }}
                  />
                </div>

                <div className="w-full h-1.5 rounded bg-black/60 border border-cyan-950 overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-75"
                    style={{ width: `${Math.min(100, liveVolume * 250)}%` }}
                  />
                </div>
              </div>
            )}

            {enrollStatus && (
              <div className="text-[11px] font-mono-tech text-cyan-300 bg-cyan-950/30 p-2 rounded border border-cyan-900/60 flex items-center space-x-2">
                {isEnrolling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span>{enrollStatus}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-2">
              {isEnrolling ? (
                <button
                  onClick={handleCancelEnrollment}
                  className="px-4 py-1.5 rounded border border-red-500/50 bg-red-950/40 text-red-300 hover:bg-red-900/60 text-xs font-orbitron transition-all"
                >
                  CANCEL
                </button>
              ) : (
                <button
                  onClick={handleStartEnrollment}
                  disabled={!newName.trim()}
                  className="flex items-center space-x-2 px-4 py-1.5 rounded border border-cyan-500/80 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 text-xs font-orbitron shadow-[0_0_15px_rgba(0,240,255,0.3)] transition-all disabled:opacity-50"
                >
                  <Mic className="w-3.5 h-3.5 text-cyan-300" />
                  <span>START 5s VOICE CALIBRATION</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-cyan-900/60 bg-black/60 flex justify-between items-center text-[10px] font-mono-tech text-cyan-500/70">
          <span>Transmitted to n8n as speaker attribution metadata</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border border-cyan-800 hover:border-cyan-500 text-cyan-300 transition-colors"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
