import React, { useState } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX, Terminal, Loader2 } from 'lucide-react';
import { JarvisAudioState } from '../services/audioEngine';

interface SubtitlesOverlayProps {
  state: JarvisAudioState;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  lastResponse: string;
  isProcessing: boolean;
  onToggleListening: () => void;
  onSubmitText: (text: string) => void;
  onStopSpeaking: () => void;
}

export const SubtitlesOverlay: React.FC<SubtitlesOverlayProps> = ({
  state,
  isListening,
  transcript,
  interimTranscript,
  lastResponse,
  isProcessing,
  onToggleListening,
  onSubmitText,
  onStopSpeaking,
}) => {
  const [manualText, setManualText] = useState('');
  const [showInput, setShowInput] = useState(false);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualText.trim()) {
      onSubmitText(manualText.trim());
      setManualText('');
      setShowInput(false);
    }
  };

  // Determine what to display in main subtitle area
  const renderSubtitleContent = () => {
    if (isProcessing) {
      return (
        <div className="flex items-center justify-center space-x-3 text-amber-300 font-orbitron tracking-widest text-sm animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
          <span>NEURAL PIPELINE INGESTING QUERY // TRANSMITTING TO n8n MATRIX...</span>
        </div>
      );
    }

    if (state === 'speaking' && lastResponse) {
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-center space-x-2 text-[10px] font-orbitron text-cyan-400/90 tracking-widest">
            <Volume2 className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
            <span>J.A.R.V.I.S. VOCAL RESPONSE:</span>
          </div>
          <p className="text-cyan-100 font-sans text-base md:text-lg leading-relaxed text-center font-medium max-w-4xl mx-auto text-glow-cyan">
            "{lastResponse}"
          </p>
        </div>
      );
    }

    if (transcript || interimTranscript) {
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-center space-x-2 text-[10px] font-orbitron text-cyan-400/90 tracking-widest">
            <Mic className="w-3.5 h-3.5 text-cyan-300 animate-bounce" />
            <span>VOICE TRANSCRIPTION INGEST:</span>
          </div>
          <p className="text-base md:text-lg text-center font-medium max-w-4xl mx-auto">
            <span className="text-white font-medium">{transcript}</span>
            <span className="text-cyan-400/80 italic ml-1.5 animate-pulse">{interimTranscript}</span>
          </p>
        </div>
      );
    }

    if (lastResponse) {
      return (
        <div className="space-y-1">
          <div className="text-[10px] font-orbitron text-cyan-500/70 tracking-widest text-center">
            LAST TRANSMISSION:
          </div>
          <p className="text-cyan-200/80 font-sans text-sm md:text-base text-center max-w-3xl mx-auto">
            "{lastResponse}"
          </p>
        </div>
      );
    }

    return (
      <div className="text-center">
        <span className="text-xs md:text-sm font-orbitron tracking-[0.2em] text-cyan-400/60 uppercase">
          AWAITING VOCAL PROMPT // PRESS SPACEBAR OR CLICK MICROPHONE
        </span>
      </div>
    );
  };

  return (
    <footer className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-5 px-6 pointer-events-none">
      {/* Live Subtitle Ticker Bar */}
      <div className="w-full max-w-4xl pointer-events-auto mb-3">
        <div className="relative rounded-xl border border-cyan-800/60 bg-black/80 backdrop-blur-xl px-6 py-3.5 shadow-[0_0_30px_rgba(0,240,255,0.15)] transition-all">
          {/* Subtle sci-fi corner markers */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />

          {/* Subtitle Content */}
          <div className="min-h-[46px] flex items-center justify-center">
            {renderSubtitleContent()}
          </div>
        </div>
      </div>

      {/* Manual Input Fallback Drawer */}
      {showInput && (
        <div className="w-full max-w-xl pointer-events-auto mb-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <form
            onSubmit={handleManualSubmit}
            className="flex items-center space-x-2 bg-black/90 border border-cyan-500 rounded-lg p-1.5 shadow-[0_0_20px_rgba(0,240,255,0.2)]"
          >
            <Terminal className="w-4 h-4 text-cyan-400 ml-2" />
            <input
              type="text"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Type command to override voice input..."
              autoFocus
              className="flex-1 bg-transparent px-2 py-1 text-sm text-cyan-200 placeholder-cyan-600 outline-none font-mono-tech"
            />
            <button
              type="submit"
              disabled={!manualText.trim()}
              className="px-3 py-1 bg-cyan-500 text-black font-orbitron font-bold text-xs rounded hover:bg-cyan-400 disabled:opacity-40 transition-colors flex items-center space-x-1"
            >
              <span>SEND</span>
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}

      {/* Action Controls & Push-to-Talk HUD bar */}
      <div className="flex items-center space-x-4 pointer-events-auto">
        {/* Toggle Manual Command Input */}
        <button
          onClick={() => setShowInput((prev) => !prev)}
          className={`p-2.5 rounded-full border transition-all ${
            showInput
              ? 'border-cyan-400 bg-cyan-950/80 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.4)]'
              : 'border-cyan-900/60 bg-black/60 text-cyan-500 hover:text-cyan-300 hover:border-cyan-600'
          }`}
          title="Manual Command Override"
        >
          <Terminal className="w-4 h-4" />
        </button>

        {/* Central Push-to-Talk Mic Button */}
        <button
          onClick={onToggleListening}
          className={`group relative flex items-center space-x-3 px-6 py-2.5 rounded-full border transition-all duration-300 ${
            isListening
              ? 'border-cyan-400 bg-cyan-500/25 text-white shadow-[0_0_25px_rgba(0,240,255,0.6)]'
              : 'border-cyan-700/60 bg-black/70 hover:bg-cyan-950/40 text-cyan-300 hover:border-cyan-400 shadow-[0_0_15px_rgba(0,0,0,0.8)]'
          }`}
        >
          <div
            className={`w-3 h-3 rounded-full ${
              isListening ? 'bg-cyan-400 animate-ping' : 'bg-cyan-700 group-hover:bg-cyan-400'
            }`}
          />
          {isListening ? (
            <Mic className="w-4 h-4 text-cyan-300 animate-pulse" />
          ) : (
            <MicOff className="w-4 h-4 text-cyan-500 group-hover:text-cyan-300" />
          )}
          <span className="font-orbitron font-semibold text-xs tracking-widest uppercase">
            {isListening ? 'LISTENING... (CLICK TO STOP)' : 'PUSH-TO-TALK [SPACE]'}
          </span>
        </button>

        {/* Stop Voice / Mute TTS Button */}
        {state === 'speaking' && (
          <button
            onClick={onStopSpeaking}
            className="p-2.5 rounded-full border border-red-500/60 bg-red-950/30 text-red-300 hover:bg-red-900/50 hover:border-red-400 transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)] animate-pulse"
            title="Silence Jarvis Voice"
          >
            <VolumeX className="w-4 h-4" />
          </button>
        )}
      </div>
    </footer>
  );
};
