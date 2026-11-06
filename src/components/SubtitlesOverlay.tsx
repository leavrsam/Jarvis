import React, { useState } from 'react';
import { 
  Mic, 
  MicOff, 
  Send, 
  Volume2, 
  VolumeX, 
  Terminal, 
  Loader2, 
  MessageSquare, 
  RotateCcw, 
  X,
  Sparkles,
  User,
  Fingerprint,
} from 'lucide-react';
import { JarvisAudioState } from '../services/audioEngine';

export interface DialogueEntry {
  query: string;
  response: string;
  timestamp: Date;
  speaker?: string;
  speakerConfidence?: number;
}

interface SubtitlesOverlayProps {
  state: JarvisAudioState;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  lastQuery: string;
  lastResponse: string;
  lastSpeaker?: string;
  speakerConfidence?: number;
  isOwner?: boolean;
  isProcessing: boolean;
  history: DialogueEntry[];
  onToggleListening: () => void;
  onSubmitText: (text: string) => void;
  onStopSpeaking: () => void;
  onReplayResponse?: (text: string) => void;
  onClearHistory?: () => void;
}

export const SubtitlesOverlay: React.FC<SubtitlesOverlayProps> = ({
  state,
  isListening,
  transcript,
  interimTranscript,
  lastQuery,
  lastResponse,
  lastSpeaker,
  speakerConfidence,
  isOwner,
  isProcessing,
  history,
  onToggleListening,
  onSubmitText,
  onStopSpeaking,
  onReplayResponse,
  onClearHistory,
}) => {
  const [manualText, setManualText] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  const formatVisualSubtitle = (text: string) =>
    text
      .replace(/<(?:short pause|long pause|pause|sigh|laugh|chuckle|breath|gasp|cough)>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualText.trim()) {
      onSubmitText(manualText.trim());
      setManualText('');
      setShowInput(false);
    }
  };

  // Determine what to display in the main subtitle HUD
  const renderSubtitleContent = () => {
    // 1. Processing State
    if (isProcessing) {
      return (
        <div className="flex flex-col items-center justify-center space-y-1.5 py-1">
          <div className="flex items-center space-x-2 text-amber-300 font-orbitron tracking-widest text-xs animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            <span>NEURAL PIPELINE INGESTING // TRANSMITTING TO n8n MATRIX</span>
          </div>
          {lastQuery && (
            <p className="text-cyan-400/70 text-xs font-mono-tech italic">
              Query: "{lastQuery}"
            </p>
          )}
        </div>
      );
    }

    // 2. User Speaking / Active Speech Transcription
    const hasUserSpeech = (transcript || interimTranscript).trim().length > 0;
    if (isListening) {
      if (hasUserSpeech) {
        return (
          <div className="space-y-1 py-0.5">
            <div className="flex items-center justify-center space-x-2 text-[10px] font-orbitron text-cyan-400 tracking-widest">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>USER ACOUSTIC INGEST:</span>
              {lastSpeaker && (
                <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-500/60 text-cyan-300 text-[9px]">
                  <Fingerprint className="w-2.5 h-2.5 text-cyan-400" />
                  <span>{lastSpeaker}</span>
                </span>
              )}
            </div>
            <p className="text-base md:text-lg text-center font-medium max-w-4xl mx-auto leading-snug">
              <span className="text-white font-medium">{transcript}</span>
              <span className="text-cyan-300 italic ml-1.5 animate-pulse">{interimTranscript}</span>
            </p>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center justify-center space-y-1 py-1">
          <div className="flex items-center space-x-2 text-cyan-300 font-orbitron tracking-widest text-xs animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span>LISTENING FOR INSTRUCTIONS... [SPEAK NOW OR HIT SPACE]</span>
          </div>
        </div>
      );
    }

    // 3. J.A.R.V.I.S. Vocal Transcript Display (Speaking or Last Response)
    if (lastResponse) {
      return (
        <div className="space-y-1.5 py-1 w-full max-w-4xl mx-auto">
          {/* Header pill with speaker info & user query badge */}
          <div className="flex items-center justify-between border-b border-cyan-950/80 pb-1.5 px-1">
            <div className="flex items-center space-x-2">
              {state === 'speaking' ? (
                <div className="flex items-center space-x-2">
                  <span className="flex space-x-0.5 items-end h-4 mr-0.5">
                    <span className="w-1 h-3.5 bg-cyan-400 rounded-full animate-[pulse_0.4s_ease-in-out_infinite]" />
                    <span className="w-1 h-5 bg-cyan-300 rounded-full animate-[pulse_0.5s_ease-in-out_infinite]" />
                    <span className="w-1 h-2.5 bg-cyan-400 rounded-full animate-[pulse_0.3s_ease-in-out_infinite]" />
                    <span className="w-1 h-4 bg-cyan-300 rounded-full animate-[pulse_0.6s_ease-in-out_infinite]" />
                  </span>
                  <span className="text-xs font-orbitron font-bold text-cyan-300 tracking-wider text-glow-cyan">
                    J.A.R.V.I.S. VOCAL TRANSMISSION [LIVE]
                  </span>
                  <span className="hidden md:inline-block text-[9px] font-mono-tech text-cyan-400/60 px-1.5 py-0.5 rounded bg-black/40 border border-cyan-950">
                    SAY "STOP", "WAIT", OR PRESS SPACE TO INTERRUPT
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-xs font-orbitron font-bold text-cyan-400 tracking-wider">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <span>J.A.R.V.I.S. TRANSCRIPT:</span>
                </div>
              )}
            </div>

            {lastQuery && (
              <div className="hidden sm:flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-900/60 text-[10px] font-mono-tech text-cyan-400/90 max-w-sm truncate">
                <span className="flex items-center space-x-1 text-cyan-300 font-orbitron text-[9px] px-1.5 py-0.2 rounded bg-cyan-900/80 border border-cyan-500/50">
                  <Fingerprint className="w-2.5 h-2.5 text-cyan-300" />
                  <span>{lastSpeaker || 'USER'}</span>
                  {speakerConfidence !== undefined && (
                    <span className="text-[8px] text-cyan-400/80">({Math.round(speakerConfidence * 100)}%)</span>
                  )}
                  {isOwner && (
                    <span className="text-[8px] text-emerald-400 font-bold ml-0.5">OWNER</span>
                  )}
                  <span>:</span>
                </span>
                <span className="truncate">"{lastQuery}"</span>
              </div>
            )}

            {onReplayResponse && (
              <button
                onClick={() => onReplayResponse(lastResponse)}
                className="text-[10px] font-orbitron text-cyan-400 hover:text-cyan-200 flex items-center space-x-1 px-2 py-0.5 rounded border border-cyan-900/80 hover:border-cyan-500 bg-cyan-950/40 hover:bg-cyan-900/50 transition-all shadow-[0_0_8px_rgba(0,240,255,0.2)]"
                title="Replay Jarvis speech"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>REPEAT</span>
              </button>
            )}
          </div>

          {/* Jarvis Spoken Words */}
          <p className="text-cyan-100 font-sans text-base md:text-lg leading-relaxed text-center font-medium max-w-4xl mx-auto text-glow-cyan px-2 max-h-36 overflow-y-auto">
            "{formatVisualSubtitle(lastResponse)}"
          </p>
        </div>
      );
    }

    // 4. Standby prompt
    return (
      <div className="text-center py-1">
        <span className="text-xs md:text-sm font-orbitron tracking-[0.25em] text-cyan-400/60 uppercase">
          AWAITING VOCAL INGEST // PRESS [SPACEBAR] OR SAY "HEY JARVIS"
        </span>
      </div>
    );
  };

  return (
    <>
      <footer className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-5 px-6 pointer-events-none">
        {/* Main Live Subtitle & Transcript Card */}
        <div className="w-full max-w-4xl pointer-events-auto mb-3">
          <div className="relative rounded-2xl border border-cyan-500/40 bg-black/85 backdrop-blur-xl px-6 py-4 shadow-[0_0_35px_rgba(0,240,255,0.18)] transition-all">
            {/* Sci-fi Corner Brackets */}
            <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400" />
            <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-400" />
            <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-400" />
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400" />

            {/* Subtitle Content */}
            <div className="min-h-[52px] flex items-center justify-center">
              {renderSubtitleContent()}
            </div>
          </div>
        </div>

        {/* Manual Input Fallback Drawer */}
        {showInput && (
          <div className="w-full max-w-xl pointer-events-auto mb-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <form
              onSubmit={handleManualSubmit}
              className="flex items-center space-x-2 bg-black/90 border border-cyan-500 rounded-xl p-2 shadow-[0_0_20px_rgba(0,240,255,0.25)]"
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
                className="px-3 py-1 bg-cyan-500 text-black font-orbitron font-bold text-xs rounded-lg hover:bg-cyan-400 disabled:opacity-40 transition-colors flex items-center space-x-1"
              >
                <span>SEND</span>
                <Send className="w-3 h-3" />
              </button>
            </form>
          </div>
        )}

        {/* Action Controls & Push-to-Talk HUD bar */}
        <div className="flex items-center space-x-3.5 pointer-events-auto">
          {/* Toggle Conversation Transcript Drawer */}
          <button
            onClick={() => setShowHistoryDrawer(!showHistoryDrawer)}
            className={`flex items-center space-x-1.5 px-3 py-2 rounded-full border transition-all ${
              showHistoryDrawer
                ? 'border-cyan-400 bg-cyan-950/80 text-cyan-200 shadow-[0_0_12px_rgba(0,240,255,0.4)]'
                : 'border-cyan-900/60 bg-black/60 text-cyan-400 hover:text-cyan-200 hover:border-cyan-600'
            }`}
            title="Open Dialogue Transcript Log"
          >
            <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-orbitron text-[10px] tracking-wider">LOGS ({history.length})</span>
          </button>

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
              {isListening ? 'LISTENING... [SPACE TO STOP]' : 'PUSH-TO-TALK [SPACE]'}
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

      {/* FULL CONVERSATION TRANSCRIPT SLIDE-OVER DRAWER */}
      {showHistoryDrawer && (
        <aside className="fixed top-20 right-6 bottom-24 w-full max-w-md z-40 bg-black/95 border border-cyan-500/60 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.25)] flex flex-col overflow-hidden backdrop-blur-2xl animate-in fade-in slide-in-from-right-4 duration-200">
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-cyan-950/90 bg-cyan-950/30">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <h3 className="font-orbitron font-bold text-xs tracking-widest text-cyan-200">
                J.A.R.V.I.S. DIALOGUE TRANSCRIPT
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              {history.length > 0 && onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className="text-[9px] font-orbitron px-2 py-0.5 rounded border border-cyan-900 hover:border-red-500 text-cyan-500 hover:text-red-300 transition-colors"
                >
                  PURGE
                </button>
              )}
              <button
                onClick={() => setShowHistoryDrawer(false)}
                className="p-1 text-cyan-500 hover:text-cyan-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Transcript Message Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono-tech">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-cyan-600/70 space-y-2">
                <Sparkles className="w-6 h-6 text-cyan-700" />
                <p className="text-xs font-orbitron">NO PRIOR TRANSMISSIONS</p>
                <p className="text-[10px]">Speak or type to begin conversational log.</p>
              </div>
            ) : (
              history.map((item, idx) => (
                <div key={idx} className="space-y-2 border-b border-cyan-950/60 pb-3">
                  {/* User Question */}
                  <div className="flex items-start space-x-2 bg-black/60 border border-cyan-900/40 p-2.5 rounded-lg">
                    <User className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex justify-between text-[9px] text-cyan-600 mb-0.5 font-orbitron">
                        <span>USER COMMAND</span>
                        <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-white leading-relaxed">
                        {item.query}
                      </p>
                    </div>
                  </div>

                  {/* Jarvis Response */}
                  <div className="flex items-start space-x-2 bg-cyan-950/20 border border-cyan-500/40 p-2.5 rounded-lg shadow-[0_0_12px_rgba(0,240,255,0.08)]">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-300 mt-0.5 shrink-0 animate-pulse" />
                    <div className="flex-1">
                      <div className="flex justify-between items-center text-[9px] text-cyan-400 mb-0.5 font-orbitron">
                        <span>J.A.R.V.I.S. RESPONSE</span>
                        {onReplayResponse && (
                          <button
                            onClick={() => onReplayResponse(item.response)}
                            className="text-[8px] text-cyan-400 hover:text-cyan-200 flex items-center space-x-0.5"
                          >
                            <Volume2 className="w-2.5 h-2.5" />
                            <span>PLAY</span>
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-cyan-100 font-sans leading-relaxed">
                        "{formatVisualSubtitle(item.response)}"
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </>
  );
};
