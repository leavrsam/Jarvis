import React, { useState } from 'react';
import { ShieldAlert, Lock, KeyRound, AlertTriangle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { login } from '../services/auth';

interface SecurityGateProps {
  onUnlock: () => void;
  /** False when the server has no JARVIS_LOGIN_PASSWORD / JARVIS_SESSION_SECRET set */
  serverConfigured: boolean;
}

export const SecurityGate: React.FC<SecurityGateProps> = ({ onUnlock, serverConfigured }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(
    serverConfigured ? null : 'LOGIN NOT CONFIGURED ON SERVER // SET JARVIS_LOGIN_PASSWORD + JARVIS_SESSION_SECRET'
  );
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(false);

  // Passcode is verified on the server; a valid one sets an HttpOnly session cookie
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = passcode.trim();
    if (!cleanInput || checking) return;
    audioEngine.ensureContext();
    setChecking(true);
    const result = await login(cleanInput);
    setChecking(false);

    if (result.ok) {
      audioEngine.playSfx('activate');
      setPasscode('');
      onUnlock();
      return;
    }
    audioEngine.playSfx('error');
    if (result.reason === 'invalid') {
      setError(
        result.attemptsLeft > 0
          ? `ACCESS DENIED // ${result.attemptsLeft} ATTEMPT${result.attemptsLeft === 1 ? '' : 'S'} LEFT`
          : 'ACCESS DENIED'
      );
    } else if (result.reason === 'locked') {
      setError(`LOCKED // TOO MANY ATTEMPTS. TRY AGAIN IN ${Math.ceil(result.retryAfterSeconds / 60)} MIN`);
    } else if (result.reason === 'not_configured') {
      setError('LOGIN NOT CONFIGURED ON SERVER // SET JARVIS_LOGIN_PASSWORD + JARVIS_SESSION_SECRET');
    } else {
      setError('CANNOT REACH SERVER // CHECK CONNECTION');
    }
  };

  return (
    <div className="relative flex h-[100dvh] w-full items-center justify-center bg-[#02040a] text-amber-400 font-mono select-none overflow-hidden hud-grid p-3 sm:p-4 pt-safe pb-safe">
      {/* Cinematic CRT Scanlines and Vignette */}
      <div className="absolute inset-0 hud-scanline pointer-events-none" />
      <div className="absolute inset-0 hud-vignette pointer-events-none" />

      {/* Futuristic Floating Reticles */}
      <div className="absolute w-[280px] h-[280px] sm:w-[500px] sm:h-[500px] rounded-full border border-amber-500/10 animate-[spin_120s_linear_infinite] pointer-events-none" />
      <div className="absolute w-[220px] h-[220px] sm:w-[350px] sm:h-[350px] rounded-full border border-dashed border-amber-500/15 animate-[spin_80s_linear_infinite_reverse] pointer-events-none" />

      {/* Main Authentication Terminal Card */}
      <div className="relative z-20 w-full max-w-md p-5 sm:p-8 border border-amber-500/30 rounded-xl sm:rounded-2xl bg-black/85 backdrop-blur-xl shadow-[0_0_50px_rgba(245,158,11,0.15)]">
        {/* Sci-Fi Corner Brackets */}
        <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-400" />
        <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-400" />
        <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-400" />
        <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-400" />

        {/* Header Badge */}
        <div className="flex flex-col items-center text-center mb-5 sm:mb-6">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-amber-500/40 bg-amber-950/30 flex items-center justify-center mb-2.5 sm:mb-3 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
            <Lock className="w-6 h-6 sm:w-7 sm:h-7 text-amber-400 animate-pulse" />
          </div>
          <h1 className="font-orbitron font-bold text-base sm:text-xl tracking-[0.2em] sm:tracking-[0.25em] text-amber-300 text-glow-amber uppercase">
            J.A.R.V.I.S. PROTOCOL
          </h1>
          <p className="text-[9px] sm:text-[10px] font-mono-tech text-amber-500/80 tracking-widest mt-1 uppercase">
            RESTRICTED ACCESS // LEVEL 5 QUANTUM CLEARANCE
          </p>
        </div>

        {/* Form Input */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 sm:gap-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-amber-500/70">
              <KeyRound className="w-4 h-4" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                if (error && serverConfigured) setError(null);
              }}
              placeholder="ENTER AUTHORIZATION PASSCODE"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className={`w-full bg-black/70 border ${
                error
                  ? 'border-red-500 text-red-200 focus:border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                  : 'border-amber-500/50 text-amber-100 focus:border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
              } pl-10 pr-10 py-2.5 sm:py-3 text-center tracking-[0.15em] sm:tracking-[0.2em] font-mono-tech text-xs sm:text-sm rounded-lg outline-none transition-all placeholder:text-amber-700/60 placeholder:text-[10px] sm:placeholder:text-xs placeholder:tracking-widest`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-amber-600 hover:text-amber-300 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="flex items-center justify-center space-x-1.5 text-red-400 text-[11px] sm:text-xs font-orbitron tracking-wider text-center">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Authenticate Button */}
          <button
            type="submit"
            disabled={!passcode.trim() || checking}
            className="group relative flex items-center justify-center space-x-2 w-full py-2.5 sm:py-3 bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/70 hover:border-amber-400 text-amber-300 font-orbitron font-semibold text-xs tracking-[0.2em] sm:tracking-[0.25em] rounded-lg transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)] disabled:opacity-40 disabled:cursor-not-allowed uppercase touch-manipulation"
          >
            <span>{checking ? 'VERIFYING...' : 'AUTHENTICATE'}</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Telemetry Footer Info */}
        <div className="mt-6 pt-4 border-t border-amber-950/80 flex items-center justify-between text-[9px] font-mono-tech text-amber-600/70">
          <span className="flex items-center space-x-1">
            <ShieldAlert className="w-3 h-3 text-amber-500/80" />
            <span>SESSION: jarvis-web</span>
          </span>
          <span>SESSION: 30 DAYS, AUTO-RENEW</span>
        </div>
      </div>
    </div>
  );
};
