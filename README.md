# J.A.R.V.I.S. // Autonomous Sci-Fi HUD Voice Assistant

A full-screen, futuristic sci-fi voice assistant web HUD inspired by Stark Industries' J.A.R.V.I.S., engineered with **Vite**, **React**, **Tailwind CSS**, **Three.js**, and **Web Audio API**.

---

## ⚡ Core Features

### 1. 3D Holographic Arc-Reactor Visualizer
- **Three.js Core & Concentric Rings**: Built with counter-rotating segmented rings, slotted stator brackets, tick-mark radials, dynamic line waveform loops, orbiting data nodes, and an icosahedron quantum wireframe core.
- **Audio Reactivity (Web Audio API AnalyserNode)**:
  - **Microphone Input (Listening)**: Pulses dynamically to user vocal amplitude and frequencies without feedback loops.
  - **TTS Output (Speaking)**: Modulates ring rotation speeds, core glow scale, and waveform vertices during British vocal speech playback.
  - **State Morphing**: Real-time material and lighting color shifts across `idle` (deep cyan breathing), `listening` (reactive white-cyan), `processing` (quantum amber pulse), and `speaking` (vocal resonance).

### 2. Speech-to-Text (STT) & Push-to-Talk
- Continuous speech transcription via `webkitSpeechRecognition` / `SpeechRecognition`.
- Live subtitle transcriptions across the bottom displaying interim spoken words with live status indicators.
- **Push-to-Talk**: Hold or toggle with **[SPACEBAR]**, click the central Arc-Reactor, or use the bottom action HUD.
- **Silence Auto-Dispatch**: Automatically transmits query upon pause in speech (configurable debounce).

### 3. Neural Backend Integration (n8n Webhook)
- Transmits payload on silence or submission:
  ```json
  {
    "query": "<user_speech_transcript>",
    "sessionId": "jarvis-web"
  }
  ```
- Endpoint: `https://n8n.wolfcubventures.com/webhook/jarvis-command`
- Parses structured responses (`output`, `response`, `text`, or raw string) and speaks the response aloud.

### 4. Text-to-Speech (TTS) Engine
- Prioritizes British voices: `en-GB-RyanNeural` (Microsoft Edge Natural Voice), `Google UK English Male`, `Daniel`, and `en-GB` variants.
- Routes synthesized voice cadences into the Web Audio `AnalyserNode` to drive real-time visualizer oscillations during vocal playback.

---

## 🚀 Quickstart

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview build
npm run preview
```

---

## 🛠️ Tech Stack
- **Framework**: React 19 + TypeScript + Vite 6
- **Styling**: Tailwind CSS v4 + Custom HUD Scanline & CRT shaders
- **3D Graphics**: Three.js
- **Audio & Speech**: Web Audio API (`AudioContext`, `AnalyserNode`) + Web Speech API (`SpeechRecognition`, `SpeechSynthesis`)
- **Icons**: Lucide React
