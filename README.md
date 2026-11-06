# J.A.R.V.I.S. // Autonomous Sci-Fi HUD Voice Assistant

A full-screen, futuristic sci-fi voice assistant web HUD inspired by Stark Industries' J.A.R.V.I.S., engineered with **Vite**, **React**, **Tailwind CSS**, **Three.js**, and **Web Audio API**.

---

## ⚡ Core Features

### 1. Hands-Free Wake Word Detection ("Hey Jarvis" / "Jarvis")
- **Continuous Client-Side Phrase Matching**: Runs natively in the browser without heavy model overhead, listening for `"Hey Jarvis"`, `"Jarvis"`, or `"Ok Jarvis"`.
- **Immediate Response & Wake Chime**: Plays an iconic 3-tone Stark Industries chime (`D5 -> A5 -> D6`), instantly activates the Arc-Reactor visualizer, and begins capturing the command.
- **Combined Utterance Extraction**: If you say *"Hey Jarvis what's the weather today?"*, it automatically strips the wake word prefix and dispatches the command without pause.
- **Battery-Aware Power Profiles (`navigator.getBattery`)**:
  - `⚡ WAKE: ON POWER` (Default): Automatically enables wake-word listening when your Mac is charging/plugged in, and pauses on battery to conserve power.
  - `🌐 WAKE: ALWAYS ON`: Keeps wake-word detection active at all times.
  - `⛔ WAKE: DISABLED`: Manual push-to-talk only.
- **Background Tab & Unfocused Support**:
  - Active audio keep-alive pipeline ensures the browser does not throttle or suspend audio capture when switched to other applications.
  - Throttles Three.js WebGL rendering loop when `document.hidden` is true, dropping GPU usage to 0% in the background.
  - Sends macOS desktop notifications when wake word is detected while working in other apps.
- **Global Hotkeys**:
  - **`Option + Space`**: Quick Mac launcher hotkey to talk to Jarvis.
  - **`Cmd + Shift + J`** / **`Ctrl + Shift + J`**: Global voice trigger.
  - **`Spacebar`**: Push-to-talk toggle when window is focused.

### 2. 3D Holographic Arc-Reactor Visualizer
- **Three.js Core & Concentric Rings**: Built with counter-rotating segmented rings, slotted stator brackets, tick-mark radials, dynamic line waveform loops, orbiting data nodes, and an icosahedron quantum wireframe core.
- **Audio Reactivity (Web Audio API AnalyserNode)**:
  - **Microphone Input (Listening)**: Pulses dynamically to user vocal amplitude and frequencies without feedback loops.
  - **TTS Output (Speaking)**: Modulates ring rotation speeds, core glow scale, and waveform vertices during British vocal speech playback.
  - **State Morphing**: Real-time material and lighting color shifts across `idle` (deep cyan breathing), `listening` (reactive white-cyan), `processing` (quantum amber pulse), and `speaking` (vocal resonance).

### 3. Speech-to-Text (STT) & Push-to-Talk
- Continuous speech transcription via `webkitSpeechRecognition` / `SpeechRecognition`.
- Live subtitle transcriptions across the bottom displaying interim spoken words with live status indicators.
- **Silence Auto-Dispatch**: Automatically transmits query upon pause in speech (configurable debounce).

### 4. Neural Backend Integration (n8n Webhook)
- Transmits payload on silence or submission:
  ```json
  {
    "query": "<user_speech_transcript>",
    "sessionId": "jarvis-web"
  }
  ```
- Endpoint: `VITE_JARVIS_WEBHOOK_URL` (default `https://n8n.wolfcubventures.com/webhook/jarvis-command`; streaming test endpoint: `/webhook/jarvis-command-stream`)
- **Streaming replies** (n8n "streaming" response mode): newline-delimited JSON events (`begin` / `item` / `end` / `error`). The `content` of each `item` is joined in order, shown on screen as it arrives, and spoken sentence by sentence, so speech starts before the full reply exists. An `error` line speaks a short failure message.
- **Legacy replies**: an `application/json` body like `{"output": "..."}` still works (as do `response`, `message`, `text` or a raw string). The body is checked too, so a stream sent as `application/json` is still read as a stream.
- Leading directives (`PLAY_YOUTUBE: <id>`, `PLAY_YOUTUBE_PLAYLIST: <id>`, `PAUSE_YOUTUBE`, `RESUME_YOUTUBE`, `STOP_YOUTUBE`, `NEXT_YOUTUBE`, `PREV_YOUTUBE`, `SET_VOLUME: <0-100>`) run as soon as they're complete and are never spoken. `<short pause>` tags become pauses, not words.
- A new command (wake word, barge-in, Space or the orb) cancels the request in flight, stops the audio and clears the queued sentences.
- The console logs `firstChunk`, `firstText` and `total` time for each request, plus time to first audio.

### 5. Text-to-Speech (TTS) Engine
- Prioritizes British voices: `en-GB-RyanNeural` (Microsoft Edge Natural Voice), `Google UK English Male`, `Daniel`, and `en-GB` variants.
- Routes synthesized voice cadences into the Web Audio `AnalyserNode` to drive real-time visualizer oscillations during vocal playback.

### 6. Persistent Password Security Gate
- Cached authorization (`localStorage.getItem('jarvis_auth_token')`) so you only enter the passcode once per device.
- Configurable via `VITE_JARVIS_SECRET` (defaults to `wolfcub`).
- Re-lock console button in the top bar.

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
- **Audio & Speech**: Web Audio API (`AudioContext`, `AnalyserNode`) + Web Speech API (`SpeechRecognition`, `SpeechSynthesis`) + Battery API
- **Icons**: Lucide React
