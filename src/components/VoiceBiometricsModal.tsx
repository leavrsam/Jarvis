import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit2,
  Fingerprint,
  Loader2,
  Mic,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { ENROLLMENT_PHRASES, MATCH_THRESHOLD, voiceBiometrics, VoiceProfile } from '../services/voiceBiometrics';
import { getModelStatus, loadSpeakerModel, onModelStatus, ModelStatus, SPEAKER_MODEL } from '../services/speaker/speakerModel';
import { voiceCapture } from '../services/speaker/voiceCapture';
import { audioEngine } from '../services/audioEngine';

interface VoiceBiometricsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileChanged?: () => void;
}

const PHRASE_MS = 6500;

type EnrollStep =
  | { kind: 'idle' }
  | { kind: 'recording'; index: number; samples: number[][]; retry: boolean }
  | { kind: 'review'; samples: number[][]; consistency: number; outlier: number | null }
  | { kind: 'done'; profile: VoiceProfile };

export const VoiceBiometricsModal: React.FC<VoiceBiometricsModalProps> = ({ isOpen, onClose, onProfileChanged }) => {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [ownerGateEnabled, setOwnerGateEnabled] = useState(false);
  const [autoLearnEnabled, setAutoLearnEnabled] = useState(true);
  const [newName, setNewName] = useState('Samuel');
  const [isOwner, setIsOwner] = useState(true);
  const [step, setStep] = useState<EnrollStep>({ kind: 'idle' });
  const [message, setMessage] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [model, setModel] = useState<ModelStatus>(getModelStatus().status);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => onModelStatus(setModel), []);

  useEffect(() => {
    if (!isOpen) return;
    setProfiles(voiceBiometrics.getProfiles());
    setOwnerGateEnabled(voiceBiometrics.isOwnerGateEnabled());
    setAutoLearnEnabled(voiceBiometrics.isAutoLearnEnabled());
    setMessage(null);
    setTestResult(null);
    setEditingId(null);
    void loadSpeakerModel().catch(() => {});
    void voiceCapture.start();
    // Live mic meter while the panel is open
    let raf = 0;
    const tick = () => {
      setLevel(voiceCapture.getLevel());
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  const refresh = () => {
    setProfiles(voiceBiometrics.getProfiles());
    onProfileChanged?.();
  };

  const recordPhrase = async (index: number, samples: number[][], retry = false): Promise<number[] | null> => {
    setStep({ kind: 'recording', index, samples, retry });
    setMessage(null);
    setProgress(0);
    const started = Date.now();
    const timer = setInterval(() => setProgress(Math.min(100, ((Date.now() - started) / PHRASE_MS) * 100)), 100);
    try {
      const { embedding } = await voiceBiometrics.recordEnrollmentSample(PHRASE_MS);
      return embedding;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      clearInterval(timer);
    }
  };

  const handleStartEnrollment = async () => {
    if (!newName.trim()) return;
    cancelledRef.current = false;
    audioEngine.playSfx('activate');
    const samples: number[][] = [];
    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
      let e: number[] | null = null;
      for (let attempt = 0; attempt < 3 && !e && !cancelledRef.current; attempt++) {
        e = await recordPhrase(i, samples, attempt > 0);
      }
      if (cancelledRef.current) return;
      if (!e) {
        setStep({ kind: 'idle' });
        setMessage('Enrollment stopped: not enough clear speech. Find a quieter spot and try again.');
        audioEngine.playSfx('error');
        return;
      }
      samples.push(e);
    }
    // Consistency check: re-record one phrase that doesn't match the others
    let check = voiceBiometrics.checkEnrollment(samples);
    if (check.outlier !== null && !cancelledRef.current) {
      setMessage(`Phrase ${check.outlier + 1} didn't sound like the others. Please read it once more.`);
      const redo = await recordPhrase(check.outlier, samples, true);
      if (redo) samples[check.outlier] = redo;
      check = voiceBiometrics.checkEnrollment(samples);
    }
    if (cancelledRef.current) return;
    setStep({ kind: 'review', samples, consistency: check.consistency, outlier: check.outlier });
  };

  const handleSave = (samples: number[][]) => {
    const profile = voiceBiometrics.saveEnrollment(newName.trim(), isOwner, samples);
    audioEngine.playSfx('response');
    setStep({ kind: 'done', profile });
    refresh();
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    setStep({ kind: 'idle' });
    setMessage('Enrollment cancelled.');
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult('Listening for 4 seconds... say anything.');
    try {
      const r = await voiceBiometrics.testVoice(4000);
      setTestResult(
        r.seconds < 0.8
          ? `Not enough speech heard (${r.seconds}s). Try again a little closer to the mic.`
          : `${r.verified ? 'Verified' : 'Not verified'}: closest voice is ${r.name}, score ${r.score.toFixed(2)} (needs ${MATCH_THRESHOLD.toFixed(2)}), ${r.seconds}s of speech.`
      );
    } catch (err) {
      setTestResult(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  const status = voiceBiometrics.getStatus();
  const owner = profiles.find((p) => p.isOwner);
  const busy = step.kind === 'recording';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-xl bg-[#030914] border border-amber-500/50 rounded-lg shadow-[0_0_40px_rgba(245,158,11,0.25)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-amber-900/60 bg-gradient-to-r from-cyan-950/40 via-blue-950/20 to-black">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded border border-amber-500/60 bg-amber-950/40 shadow-[0_0_15px_rgba(245,158,11,0.4)]">
              <Fingerprint className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-sm tracking-widest text-amber-200">VOICE ID</h2>
              <p className="text-[10px] font-mono-tech text-amber-400/70">
                Neural voiceprints ({SPEAKER_MODEL.name}), computed on this device
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-amber-400/60 hover:text-amber-200 p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          {/* Engine status */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono-tech">
            <span
              className={`px-2 py-0.5 rounded border ${
                model === 'ready'
                  ? 'border-emerald-600 text-emerald-300'
                  : model === 'error'
                    ? 'border-red-600 text-red-300'
                    : 'border-amber-700 text-amber-300'
              }`}
            >
              MODEL:{' '}
              {model === 'ready'
                ? 'READY'
                : model === 'error'
                  ? 'FAILED TO LOAD'
                  : `LOADING (${Math.round(SPEAKER_MODEL.bytes / 1e6)} MB, first time only)`}
            </span>
            {model === 'error' && (
              <button
                onClick={() => void loadSpeakerModel().catch(() => {})}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-700 text-amber-300"
              >
                <RefreshCw className="w-3 h-3" /> RETRY
              </button>
            )}
            <span className={`px-2 py-0.5 rounded border ${status.micBuffering ? 'border-emerald-600 text-emerald-300' : 'border-amber-800 text-amber-500'}`}>
              MIC: {status.micBuffering ? 'LISTENING' : 'OFF'}
            </span>
            <span className="flex items-center gap-1 text-amber-500">
              <Activity className="w-3 h-3" />
              <span className="inline-block w-20 h-1.5 bg-amber-950 rounded overflow-hidden">
                <span className="block h-full bg-amber-400" style={{ width: `${Math.round(level * 100)}%` }} />
              </span>
            </span>
          </div>
          {model === 'error' && (
            <div className="text-[10px] text-red-300">{getModelStatus().error}. Until it loads, voice commands count as guests.</div>
          )}

          {status.legacyProfilesDiscarded && (
            <Banner tone="warn">
              Voice ID was upgraded to neural voiceprints. Old voiceprints can't be converted, so please enroll again
              below.
            </Banner>
          )}
          {!owner && (
            <Banner tone="warn">
              No owner enrolled: voice ID is inactive and every command is treated as the owner's (this device is
              logged in). Enroll yourself below to turn it on.
            </Banner>
          )}

          {/* Guided enrollment */}
          <div className="p-3 rounded border border-amber-800/70 bg-amber-950/10 space-y-3">
            <div className="flex items-center gap-2 font-orbitron text-xs text-amber-200 tracking-wider">
              <UserPlus className="w-4 h-4 text-amber-400" /> ENROLL A VOICE (5 PHRASES, ~40 S)
            </div>

            {step.kind === 'idle' && (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name"
                    className="flex-1 bg-black/80 border border-amber-800 focus:border-amber-400 rounded px-3 py-2 text-sm text-amber-100 outline-none"
                  />
                  <label className="flex items-center gap-2 text-xs text-amber-300">
                    <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} className="accent-amber-400" />
                    Owner
                  </label>
                </div>
                <p className="text-[10px] text-amber-500/90">
                  Use the device and spot where you'll normally talk to Jarvis (e.g. the S9 on its stand), at your normal
                  volume. Each phrase records for {PHRASE_MS / 1000} seconds.
                </p>
                <button
                  onClick={handleStartEnrollment}
                  disabled={!newName.trim() || model === 'error'}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded bg-amber-500 text-black text-xs font-orbitron font-bold disabled:opacity-40"
                >
                  <Mic className="w-4 h-4" /> START ENROLLMENT
                </button>
              </>
            )}

            {step.kind === 'recording' && (
              <div className="space-y-2">
                <div className="text-[11px] text-amber-400">
                  Phrase {step.index + 1} of {ENROLLMENT_PHRASES.length}
                  {step.retry ? ' (again)' : ''}: read this aloud now
                </div>
                <div className="p-3 rounded border border-amber-500/60 bg-black/60 text-sm text-amber-100">
                  "{ENROLLMENT_PHRASES[step.index]}"
                </div>
                <div className="h-1.5 bg-amber-950 rounded overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-amber-500">
                    {model !== 'ready' ? 'Loading the voice model...' : `${step.samples.length} phrase(s) captured`}
                  </span>
                  <button onClick={handleCancel} className="text-[10px] text-amber-500 hover:text-amber-300">
                    CANCEL
                  </button>
                </div>
              </div>
            )}

            {step.kind === 'review' && (
              <div className="space-y-2">
                <div className="text-[11px] text-amber-200">
                  Consistency across your phrases: <strong>{Math.round(step.consistency * 100)}%</strong>{' '}
                  {step.consistency >= 0.6 ? '(excellent)' : step.consistency >= 0.5 ? '(good)' : '(low: background noise or a different mic?)'}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(step.samples)}
                    className="flex-1 py-2 rounded bg-emerald-600 text-black text-xs font-orbitron font-bold"
                  >
                    SAVE {newName.trim().toUpperCase()}
                  </button>
                  <button onClick={() => setStep({ kind: 'idle' })} className="px-3 py-2 rounded border border-amber-700 text-xs text-amber-300">
                    DISCARD
                  </button>
                </div>
              </div>
            )}

            {step.kind === 'done' && (
              <div className="flex items-center gap-2 text-[11px] text-emerald-300">
                <CheckCircle2 className="w-4 h-4" /> Saved {step.profile.name}
                {step.profile.isOwner ? ' as owner' : ''}. Try "Test my voice" below.
                <button onClick={() => setStep({ kind: 'idle' })} className="ml-auto text-amber-400 underline">
                  enroll another
                </button>
              </div>
            )}

            {message && <div className="text-[11px] text-amber-300">{message}</div>}
          </div>

          {/* Test */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              onClick={handleTest}
              disabled={testing || busy || profiles.length === 0 || model === 'error'}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded border border-amber-600 text-xs font-orbitron text-amber-200 disabled:opacity-40"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />} TEST MY VOICE
            </button>
            {testResult && <span className="text-[11px] text-amber-200">{testResult}</span>}
          </div>

          {/* Settings */}
          <Toggle
            icon={<Sparkles className="w-5 h-5 text-amber-400" />}
            title="REMEMBER NEW VOICES"
            detail='Clearly different voices become guest profiles automatically; "Jarvis, I&apos;m Sarah" names them.'
            on={autoLearnEnabled}
            onLabel="ON"
            offLabel="OFF"
            onToggle={() => {
              voiceBiometrics.setAutoLearnEnabled(!autoLearnEnabled);
              setAutoLearnEnabled(!autoLearnEnabled);
            }}
          />
          <Toggle
            icon={ownerGateEnabled ? <ShieldCheck className="w-5 h-5 text-emerald-400" /> : <ShieldAlert className="w-5 h-5 text-amber-400" />}
            title="OWNER-ONLY MODE"
            detail="Only carry out voice commands verified as the owner. Others get a polite refusal. (Off: guests can use the guest-safe features.)"
            on={ownerGateEnabled}
            onLabel="ARMED"
            offLabel="OFF"
            onToggle={() => {
              voiceBiometrics.setOwnerGateEnabled(!ownerGateEnabled);
              setOwnerGateEnabled(!ownerGateEnabled);
            }}
          />

          {/* Profiles */}
          <div className="space-y-2">
            <div className="text-xs font-orbitron text-amber-300 tracking-wider">VOICEPRINTS ({profiles.length})</div>
            {profiles.length === 0 ? (
              <div className="p-4 rounded border border-dashed border-amber-900/60 text-center text-xs text-amber-500/70">
                No voiceprints yet.
              </div>
            ) : (
              profiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2.5 rounded border border-amber-950/80 bg-amber-950/20">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-full border border-amber-500/40 flex items-center justify-center bg-black/60 shrink-0">
                      <User className="w-3.5 h-3.5 text-amber-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {editingId === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={editNameValue}
                            onChange={(e) => setEditNameValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                voiceBiometrics.renameProfile(p.id, editNameValue);
                                setEditingId(null);
                                refresh();
                              }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="px-2 py-0.5 rounded bg-black border border-amber-400 text-xs text-amber-200 outline-none"
                          />
                          <button
                            onClick={() => {
                              voiceBiometrics.renameProfile(p.id, editNameValue);
                              setEditingId(null);
                              refresh();
                            }}
                            className="p-1 rounded bg-amber-500 text-black"
                            aria-label="Save name"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-orbitron text-xs text-amber-200 truncate">{p.name}</span>
                          <span
                            className={`px-1.5 rounded border text-[8px] font-mono-tech shrink-0 ${
                              p.isOwner
                                ? 'border-amber-500/60 text-amber-300'
                                : p.isAutoDiscovered
                                  ? 'border-amber-700 text-amber-400'
                                  : 'border-emerald-600/60 text-emerald-300'
                            }`}
                          >
                            {p.isOwner ? 'OWNER' : p.isAutoDiscovered ? 'AUTO-DISCOVERED' : 'GUEST'}
                          </span>
                          <button
                            onClick={() => {
                              setEditingId(p.id);
                              setEditNameValue(p.name);
                            }}
                            className="text-amber-500 hover:text-amber-300 p-0.5"
                            aria-label="Rename"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <div className="text-[10px] font-mono-tech text-amber-400/60 truncate">
                        {p.enrollment.length} enrollment sample{p.enrollment.length === 1 ? '' : 's'}
                        {p.consistency != null ? ` · consistency ${Math.round(p.consistency * 100)}%` : ''} · recognized{' '}
                        {p.samplesCount}×{p.adaptive?.length ? ` · ${p.adaptive.length} adaptive` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      voiceBiometrics.deleteProfile(p.id);
                      refresh();
                    }}
                    className="text-red-400/60 hover:text-red-300 p-1.5 rounded hover:bg-red-950/40 shrink-0"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Banner: React.FC<{ tone: 'warn'; children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2 p-2.5 rounded border border-amber-600/60 bg-amber-950/30 text-[11px] text-amber-200">
    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

const Toggle: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
}> = ({ icon, title, detail, on, onLabel, offLabel, onToggle }) => (
  <div className="flex items-center justify-between gap-3 p-3 rounded border border-amber-900/60 bg-black/40">
    <div className="flex items-center gap-3">
      {icon}
      <div>
        <div className="font-orbitron text-xs text-amber-200 tracking-wider">{title}</div>
        <div className="text-[10px] font-mono-tech text-amber-400/60">{detail}</div>
      </div>
    </div>
    <button
      onClick={onToggle}
      className={`px-3 py-1 rounded text-xs font-mono-tech border shrink-0 ${
        on ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300' : 'bg-black/60 border-amber-900/60 text-amber-500'
      }`}
    >
      {on ? onLabel : offLabel}
    </button>
  </div>
);
