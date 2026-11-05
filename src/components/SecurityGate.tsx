import React, { useState } from 'react';
import { ShieldAlert, Lock, KeyRound, AlertTriangle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';

interface SecurityGateProps {
  onUnlock: () => void;
  expectedSecret: string;
}

export const SecurityGate: React.FC<SecurityGateProps> = ({ onUnlock, expectedSecret }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = passcode.trim();
    const cleanSecret = expectedSecret.trim();

    if (cleanInput && (cleanInput === cleanSecret || cleanInput.toLowerCase() === cleanSecret.toLowerCase())) {
      audioEngine.ensureContext();
      audioEngine.playSfx('activate');
      localStorage.setItem('jarvis_auth_token', cleanInput);
      onUnlock();
    } else {
      audioEngine.ensureContext();
      audioEngine.playSfx('error');
      setError(true);
      setAttempts(prev => prev + 1);
    }
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-[#02040a] text-cyan-400 font-mono select-none overflow-hidden hud-grid">
      {/* Cinematic CRT Scanlines and Vignette */}
      <div className="absolute inset-0 hud-scanline pointer-events-none" />
      <div className="absolute inset-0 hud-vignette pointer-events-none" />

      {/* Futuristic Floating Reticles */}
      <div className="absolute w-[500px] h-[500px] rounded-full border border-cyan-500/10 animate-[spin_120s_linear_infinite] pointer-events-none" />
      <div className="absolute w-[350px] h-[350px] rounded-full border border-dashed border-cyan-500/15 animate-[spin_80s_linear_infinite_reverse] pointer-events-none" />

      {/* Main Authentication Terminal Card */}
      <div className="relative z-20 w-full max-w-md mx-4 p-8 border border-cyan-500/30 rounded-2xl bg-black/80 backdrop-blur-xl shadow-[0_0_50px_rgba(0,240,255,0.15)]">
        {/* Sci-Fi Corner Brackets */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />

        {/* Header Badge */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-xl border border-cyan-500/40 bg-cyan-950/30 flex items-center justify-center mb-3 text-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.25)]">
            <Lock className="w-7 h-7 text-cyan-400 animate-pulse" />
          </div>
          <h1 className="font-orbitron font-bold text-lg md:text-xl tracking-[0.25em] text-cyan-300 text-glow-cyan uppercase">
            J.A.R.V.I.S. PROTOCOL
          </h1>
          <p className="text-[10px] font-mono-tech text-cyan-500/80 tracking-widest mt-1 uppercase">
            RESTRICTED ACCESS // LEVEL 5 QUANTUM CLEARANCE
          </p>
        </div>

        {/* Form Input */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-cyan-500/70">
              <KeyRound className="w-4 h-4" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                if (error) setError(false);
              }}
              placeholder="ENTER AUTHORIZATION PASSCODE"
              autoFocus
              className={`w-full bg-black/70 border ${
                error
                  ? 'border-red-500 text-red-200 focus:border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                  : 'border-cyan-500/50 text-cyan-100 focus:border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.15)]'
              } pl-10 pr-10 py-3 text-center tracking-[0.2em] font-mono-tech text-sm rounded-lg outline-none transition-all placeholder:text-cyan-700/60 placeholder:text-xs placeholder:tracking-widest`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-cyan-600 hover:text-cyan-300 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center justify-center space-x-2 text-red-400 text-xs font-orbitron tracking-wider animate-bounce">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>ACCESS DENIED // INVALID AUTHORIZATION CODE ({attempts})</span>
            </div>
          )}

          {/* Authenticate Button */}
          <button
            type="submit"
            disabled={!passcode.trim()}
            className="group relative flex items-center justify-center space-x-2 w-full py-3 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/70 hover:border-cyan-400 text-cyan-300 font-orbitron font-semibold text-xs tracking-[0.25em] rounded-lg transition-all shadow-[0_0_20px_rgba(0,240,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed uppercase"
          >
            <span>AUTHENTICATE</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Telemetry Footer Info */}
        <div className="mt-6 pt-4 border-t border-cyan-950/80 flex items-center justify-between text-[9px] font-mono-tech text-cyan-600/70">
          <span className="flex items-center space-x-1">
            <ShieldAlert className="w-3 h-3 text-cyan-500/80" />
            <span>SESSION: jarvis-web</span>
          </span>
          <span>AUTH PERSIST: CACHED</span>
        </div>
      </div>
    </div>
  );
};
