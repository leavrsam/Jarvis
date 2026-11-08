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
- Endpoint: the browser posts to **`/api/jarvis-command`** (`api/jarvis-command.js`), a same-origin
  proxy on the app server. It forwards the body unchanged to n8n, adds the `X-Jarvis-Key` header,
  and streams n8n's reply back as-is. The webhook URL and secret never reach the browser.
  - Server environment variables (Vercel → Settings → Environment Variables, or `.env` locally):
    - `JARVIS_WEBHOOK_URL`: the n8n webhook, e.g. `https://<your-n8n>/webhook/jarvis-command`
      (or the `jarvis-command-stream` test endpoint).
    - `JARVIS_WEBHOOK_SECRET`: the value n8n expects in `X-Jarvis-Key`.
    - Optional `JARVIS_ALLOWED_ORIGINS`: extra origins allowed to call the proxy.
    - Never prefix these with `VITE_`: `VITE_` variables are bundled into the public client.
  - The proxy only accepts same-origin POSTs, rate-limits each IP to 30 requests/minute (per server
    instance), cancels the n8n call when the browser disconnects (e.g. you interrupt Jarvis), and
    never relays n8n error bodies. If n8n rejects the key or can't be reached, Jarvis says
    "I can't reach my systems, sir."
  - `isAuthorizedOwner`, `speaker` and `speakerConfidence` are set by the app from voice
    identification and pass through untouched.
- **Streaming replies** (n8n "streaming" response mode): newline-delimited JSON events (`begin` / `item` / `end` / `error`). The `content` of each `item` is joined in order, shown on screen as it arrives, and spoken sentence by sentence, so speech starts before the full reply exists. An `error` line speaks a short failure message.
- **Legacy replies**: an `application/json` body like `{"output": "..."}` still works (as do `response`, `message`, `text` or a raw string). The body is checked too, so a stream sent as `application/json` is still read as a stream.
- Leading directives (`PLAY_YOUTUBE: <id>`, `PLAY_YOUTUBE_PLAYLIST: <id>`, `PAUSE_YOUTUBE`, `RESUME_YOUTUBE`, `STOP_YOUTUBE`, `NEXT_YOUTUBE`, `PREV_YOUTUBE`, `SET_VOLUME: <0-100>`) run as soon as they're complete and are never spoken. `<short pause>` tags become pauses, not words.
- A new command (wake word, barge-in, Space or the orb) cancels the request in flight, stops the audio and clears the queued sentences.
- The console logs `firstChunk`, `firstText` and `total` time for each request, plus time to first audio.

### 5. Text-to-Speech (TTS) Engine
- Prioritizes British voices: `en-GB-RyanNeural` (Microsoft Edge Natural Voice), `Google UK English Male`, `Daniel`, and `en-GB` variants.
- Routes synthesized voice cadences into the Web Audio `AnalyserNode` to drive real-time visualizer oscillations during vocal playback.

### 6. Server-Side Login
- The passcode is checked **on the server** (`api/auth.js`) against `JARVIS_LOGIN_PASSWORD`, using scrypt
  (deliberately slow) and a constant-time comparison. Nothing secret is in the browser code.
- **Lockout:** 5 wrong passcodes from one IP within 15 minutes lock that IP for 15 minutes; 20 failures from
  all IPs within an hour lock new logins for 15 minutes. Devices already logged in keep working.
- A successful login sets an **HttpOnly, Secure, SameSite=Strict** cookie (`__Host-jarvis_session`), signed
  with `JARVIS_SESSION_SECRET`. It lasts **30 days and renews itself** whenever it's used (at most every
  12 hours), so an always-on device stays logged in indefinitely.
- `/api/jarvis-command`, `/api/tts` and `/api/voice-lab` answer **401** without a valid session; the app then
  shows the login screen.
- The lock button in the top bar logs this device out. To log **every** device out, change
  `JARVIS_SESSION_SECRET` (or the password) and redeploy.
- Because the cookie is `Secure`, logging in needs HTTPS (or `localhost` during development).

| Server env var (never `VITE_`) | Value |
|---|---|
| `JARVIS_LOGIN_PASSWORD` | The passcode you type on the login screen |
| `JARVIS_SESSION_SECRET` | A random string of at least 32 characters, e.g. from `openssl rand -base64 32` |

If either is missing (or the secret is shorter than 32 characters), nobody can log in and the login
screen says what to set.

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

## 🗣️ Voice ID (speaker recognition)

Jarvis tells the owner apart from guests by voice, so n8n's `isAuthorizedOwner` reflects who actually spoke.

- **Model:** WeSpeaker CAM++ (VoxCeleb), a neural speaker-verification model producing 512-dim voiceprints.
  It runs **on the device** with onnxruntime-web (WebAssembly); voice audio never leaves the browser. The
  29 MB model is downloaded once from Hugging Face, checked against a pinned SHA-256, and cached.
- **Audio:** while unlocked, the mic is buffered in memory (last 15 s), so the words right after
  "Hey Jarvis" are captured. Stretches where Jarvis is speaking (plus a short tail) are left out.
- **Owner has to be verified.** Once an owner is enrolled, a voice command counts as the owner's only if it
  scores **≥ 0.50** against the owner's voiceprint. Too little speech, a weaker match, or the model being
  unavailable all mean **guest**. Typed commands count as the owner (the device is logged in). Until an owner
  is enrolled, voice ID is inactive and everything counts as the owner.
- **Enroll:** HUD → VOICE ID → *Start enrollment*: read 5 phrases (~40 s) on the device and spot you normally
  use. A phrase that doesn't match the others is re-recorded. *Test my voice* shows your live score.
- **Owner-only mode:** voice commands not verified as the owner aren't sent to n8n; Jarvis politely declines.
- **Guests are remembered without registering.** A clearly new voice (≥ 1.5 s of speech) becomes a guest
  profile. **During their visit** (3 minutes between commands), their follow-ups keep teaching their voiceprint
  (up to 12 samples), even ones that match only moderately (≥ 0.35, as long as it isn't the owner), so one
  short first sentence becomes a solid voiceprint before they leave. With room-level background noise this
  took next-visit recognition from 3/8 (single sample) to 7/8.
- **Names:** "My name is Sarah", "Call me Sarah", or "(Hi Jarvis,) I'm Sarah" at the start of a sentence name
  the guest, and Jarvis confirms: "Lovely to meet you, Sarah. I'll remember your voice." Phrases like "I'm
  hungry" or "I'm not sure" are ignored. The owner can say "Jarvis, meet my sister Sarah": the next new voice
  within 2 minutes gets that name. Deliberately chosen names are never overwritten.
- **Duplicates merge:** two guest profiles that sound like the same person (similarity ≥ 0.60; different people
  measured ≤ 0.20) are merged automatically, keeping the given name. VOICE ID also has "Same person as…" to merge
  by hand.
- **Facts about guests** are stored by the n8n agent (long-term memory tagged `[User: <name>]`), keyed by the
  `speaker` name voice ID sends, so they come back whenever the voice is recognized.
- Profiles keep their enrollment samples, plus a few recent high-confidence matches, so they adapt without
  drifting toward someone else.
- **Accuracy (measured):** LibriSpeech, 10 speakers, 5-phrase enrollment: 2–3 s commands identified correctly
  86/87; no strangers accepted at the threshold; 1–2% of owner commands fall back to guest. In Chrome with a
  simulated mic: owner scored 0.83–0.88, strangers 0.08–0.37. A phone mic in a room scores lower than clean
  speech, which is why anything uncertain is treated as a guest.
- Voiceprints are stored per device (localStorage), so enroll on each device you use.
- **Interruptions & echo:** while Jarvis talks, speech that is mostly his own words (fuzzy-matched, so
  mishearings like "1 mom sure" for "One moment, sir" count) is ignored. Interrupting needs a stop word
  ("stop", "wait", "Jarvis"...) or a finished phrase of 3+ words; partial guesses alone never interrupt.
  VOICE ID → *Recent listening events* shows each ignored echo, interruption and voice ID decision.

---

## 👂 Built-in Listening (wake word for Android / Fully Kiosk)

The browser's speech recognizer doesn't exist in Android WebView (Fully Kiosk), and in Chrome on
some phones it hears only silence while voice ID holds the microphone. The **built-in engine**
(the default) avoids both: one shared mic stream does everything.

1. **"Hey Jarvis" is detected on the device** with the openWakeWord models in
   `public/models/wakeword/` (melspectrogram → embedding → `hey_jarvis_v0.1`), run with
   onnxruntime-web. No audio leaves the device while waiting. Say **"hey Jarvis"**, not
   just "Jarvis". The models are from openWakeWord v0.5.1 and licensed **CC BY-NC-SA 4.0**
   (non-commercial use only).
2. **The command is recorded from the same stream.** That includes the last ~2 s, so "Hey Jarvis,
   what's the weather?" said in one breath is kept whole. Recording stops after ~0.9 s of silence.
3. **The command is transcribed by Deepgram Nova-3** through `POST /api/transcribe` (same-origin,
   40/min, login required). The key stays server-side: set `DEEPGRAM_API_KEY` in Vercel →
   Settings → Environment Variables. This is the same key the Voice Lab uses. A command costs
   about $0.0004.

**Live transcription (default):** while you talk, the audio streams to Deepgram **Flux**, a model
built for voice assistants. Flux transcribes as you speak and decides when you've finished your
sentence from the words and the delivery, not only from silence, so the text is ready right
away. The browser connects with a 30-second token from `POST /api/stt-token` (same-origin,
60/min, login required), and the API key never leaves the server. If live transcription isn't
available, the app records and uploads to `/api/transcribe` as before. The key needs the
**Member** role or higher to issue tokens. You can turn live transcription off under
**VOICE ID → LISTENING ENGINE**.

**Conversation flow**, modelled on Alexa Follow-Up Mode and Google Continued Conversation:
- After a reply, Jarvis keeps listening without the wake word for **6 s if he asked you
  something, otherwise 3 s**. The window counts until you *start* talking, so it never cuts you
  off mid-sentence.
- A cyan "STILL LISTENING" ring counts down on screen. A soft falling two-note tone plays when the
  window closes; after that, say "hey Jarvis" again.
- Only the person who started the conversation can follow up without the wake word. Voice ID
  checks each follow-up, so friends talking nearby aren't answered. Anyone can still say
  "hey Jarvis". If voice ID isn't sure who's speaking, the follow-up is accepted.
- "Thanks", "that's all", "never mind", "I'm good" and similar replies end the conversation.
- Each reply's timing (voice ID, first text from n8n, first audio) and how soon your words were
  transcribed show up in **VOICE ID → Recent listening events**.

Switch engines under **VOICE ID → LISTENING ENGINE**. The panel shows a live wake-word score
meter (trigger at 0.8), detections, transcriptions and errors. If the models can't load or
`DEEPGRAM_API_KEY` is missing, the app falls back to the browser recognizer.

---

## 🖥️ Jarvis's Screen (images, video, cameras)

Jarvis can put things on a screen in the HUD. Like the YouTube directives, these go at the start
of a reply, one per line. They are carried out and never spoken or shown in the subtitles:

| Directive | What it does |
| --- | --- |
| `SHOW_IMAGE_SEARCH: <what to show>` | **The default for "show me a picture of…".** The app finds a real, openly licensed photo (Openverse, then Wikimedia Commons; no keys needed) and shows it with a small credit line. Language models invent image URLs that don't exist, so Jarvis should only name what to show. |
| `SHOW_IMAGE: <https url>` | Shows the image, fading in. Stays until `CLEAR_SCREEN`, another `SHOW_*`, the ✕ button, or 3 minutes. |
| `SHOW_VIDEO: <https url>` | Plays a direct video file (mp4/webm) with controls. It is muted while Jarvis talks or listens, like YouTube's volume ducking. Close it with ✕. |
| `SHOW_CAMERA: <camera name>` | Shows a snapshot from `/api/camera`, with its caption ("Live" or "Last motion 2:39 PM"), a refresh button, and an automatic refresh every 60 s. Closes after 3 minutes. |
| `CLEAR_SCREEN` | Hides the screen. |

Example reply: `SHOW_CAMERA: front door` on the first line, then `Here's the front door, sir.`

- Only `https://` URLs are loaded. Anything else is ignored.
- A camera name may contain letters, digits, spaces and `_ - .`, up to 64 characters.
- If an image, video or camera snapshot fails to load, the screen shows "Couldn't load that …".
- On wide displays (the kiosk/TV), the screen fills the left side, the reactor moves to the right,
  and the subtitles stay at the bottom.

**Image search:** `GET /api/image-search?q=<what>` (same-origin, login, 20/min) searches Openverse
(photographs first), falls back to Wikimedia Commons, and returns the first of the top results
that actually loads, with title, creator, licence and source. Results are cached for 30 minutes.

**Camera proxy:** `GET /api/camera?camera=<name>` calls `JARVIS_MEDIA_URL?camera=<name>` with the
`X-Jarvis-Key: JARVIS_WEBHOOK_SECRET` header (the same secret as the command proxy). It returns
the image plus its `X-Image-Source` header. Requests need a login session, come from the same
origin only, and are limited to 30/min. Set
`JARVIS_MEDIA_URL=https://n8n.wolfcubventures.com/webhook/jarvis-media` in Vercel → Settings →
Environment Variables (server-side, no `VITE_`). The n8n webhook must answer with an image
(`image/jpeg` or `image/png`; SVG is refused).

The directive parser lives in `src/services/directives.ts` and its tests in
`src/services/directives.test.ts`. Run them with `npm test`.

---

## 🔒 Server Route Protection

All server routes (`/api/tts`, `/api/jarvis-command`, `/api/voice-lab`, `/api/transcribe`, `/api/stt-token`, `/api/image-search`, `/api/camera`) share `api/_lib/requestGuard.js`:

- **Same-origin only.** Requests must come from the app's own pages (matching `Origin`, or
  `Sec-Fetch-Site: same-origin`). Other websites, and scripts that don't send browser headers, get 403.
  No CORS headers are sent, so other sites' pages can't call these routes. Add extra origins with
  `JARVIS_ALLOWED_ORIGINS` (comma-separated) if you ever need to.
- **Per-IP rate limits:** `/api/jarvis-command` 30/min, `/api/tts` 60/min, `/api/voice-lab` 60/min, `/api/transcribe` 40/min, `/api/stt-token` 60/min, `/api/image-search` 20/min, `/api/camera` 30/min
  (429 with `Retry-After`). Counted in memory on each server instance, so they stop runaway loops
  and casual abuse rather than acting as one global limit.
- All of them also require a logged-in session (see **Server-Side Login**).

---

## 🎧 Voice Comparison Lab (pick Jarvis's TTS provider by ear)

Open it from **VOICE → Compare TTS providers by ear**, or go to `/#/voice-compare` (log in first).
It plays the same test lines through each provider so you can compare them side by side, including a blind
test with star ratings. It is separate from the live voice: `api/tts.js` and the audio engine are unchanged.

- Each line is generated **once per voice** and cached in your browser (IndexedDB) and on the server (temp dir),
  so replays cost nothing. ↻ regenerates a clip and calls the provider again.
- Shown per play: time to first audio, total generation time, characters, and estimated cost at list price.
- `<short pause>` is handled like the live pipeline: sent as-is to Gemini, turned into a comma pause elsewhere.

### Provider keys

Set these as **server-side** environment variables: in `.env` / `.env.local` for `npm run dev`, and in
Vercel → Project → Settings → Environment Variables for deployments. Never prefix them with `VITE_`, which
would bundle them into the browser. A provider whose key isn't set shows as "not configured".

| Provider (voices) | Env vars | How to get a key | Free tier | List price |
|---|---|---|---|---|
| Google Cloud TTS, Chirp 3 HD (`en-GB-Chirp3-HD-Iapetus`, `-Algieba`) | `GOOGLE_TTS_API_KEY` | Google Cloud console → create/select a project → enable **Cloud Text-to-Speech API** → APIs & Services → Credentials → **Create API key** (restrict it to the Text-to-Speech API). Billing must be enabled. | 1M Chirp 3 HD characters/month | $30 / 1M chars |
| Azure Speech (`en-GB-RyanNeural`, `en-GB-ThomasNeural`) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (e.g. `eastus`) | Azure portal → Create resource → **Speech** → pricing tier **Free F0** → Keys and Endpoint → copy Key 1 and the Location/Region. | F0: 0.5M neural chars/month | $15 / 1M chars |
| OpenAI `gpt-4o-mini-tts` (`cedar`, `ash`) | `OPENAI_API_KEY` | platform.openai.com → API keys → **Create new secret key** (needs prepaid credit). | None | ~$0.015 / min of audio ($12 / 1M audio tokens) |
| Deepgram Aura-2 (`aura-2-draco-en`) | `DEEPGRAM_API_KEY` | console.deepgram.com → sign up → API Keys → **Create a New API Key**. | $200 free credit, no card | $0.030 / 1K chars |
| Deepgram Flux TTS (all seven British males: Jack, Tanner, Colin, Rufus, Kit, Sean, Conor) | `DEEPGRAM_API_KEY` (same key) | Same as above. | Uses the same credit | $0.045 / 1K chars |
| Edge TTS (`en-GB-RyanNeural`, current fallback) | none | Not needed. | Free | Free (unofficial endpoint, no SLA) |
| Gemini 3.8 Flash TTS (your designed voice) | `GEMINI_API_KEY` | aistudio.google.com → **Get API key**. The lab also uses the key you saved in the HUD's voice settings. | Free tier is rate-limited (about 100 requests/day) | $9 / 1M audio tokens (~$0.0135 / min) |

Notes:
- Chirp 3 HD male voices available in en-GB: Achird, Algenib, Algieba, Alnilam, Charon, Enceladus, Fenrir,
  Iapetus, Orus, Puck, Rasalgethi, Sadachbia, Sadaltager, Schedar, Umbriel, Zubenelgenubi. Change which two
  are tested with `VOICE_LAB_GOOGLE_VOICES=Iapetus,Algieba`.
- Deepgram Aura-2 has only one UK-English male voice (Draco), and its only delivery control is speed.
  Deepgram's newer **Flux TTS** has seven British male voices (Kit, Colin, Sean, Conor, Jack, Rufus, Tanner);
  all are in the lab. Each Deepgram row has a **speed** control, and Flux rows also have **delivery**
  (Deepgram's beta "expressivity", -2 calm to +2 animated). Each setting is cached as its own clip. Flux
  also gets real pauses for `<short pause>` (500 ms) and `<long pause>` (1 s), unless speed is above 1.15,
  which Deepgram doesn't allow together with pauses.
- Streaming: Azure, OpenAI and Deepgram Aura-2 stream raw PCM and play as it arrives; Edge streams MP3 (played
  progressively through Media Source Extensions). Google Chirp 3 HD streams only over gRPC, so this page
  uses its REST API (not streamed); Flux likewise streams only over WebSocket, so its batch API is used. Gemini is not streamed, matching the live pipeline.
- **Jarvis polish** (checkbox above the grid) plays every voice through the live app's sound processing
  (chest warmth, diction crispness, suit-intercom sheen, starting from your Voice Lab settings), plus a
  pitch shift of up to ±3 semitones. It runs in the browser on cached clips, so it costs nothing. With it
  on, clips play after they finish downloading.
- **Auto-match to Gemini** (panel above the grid): pick a voice and press *Analyze and match*. It uses
  the 4 test lines (generating any missing clips once), measures pitch, pitch movement, pace, pauses and
  tone balance for both voices through the live app's sound, and sets pitch / extra warmth / extra
  crispness for the matched voice in two refining passes. Pace and delivery are provider settings, so it
  suggests a new speed (one click, then re-run to regenerate) and, for Flux, a delivery step when Gemini's
  intonation is noticeably more or less animated. The Gemini reference is never adjusted.
- Prices are list prices checked in November 2026; free tiers aren't subtracted in the page's estimates.
- The lab endpoint requires a logged-in session, like the rest of the app.

---

## 🛠️ Tech Stack
- **Framework**: React 19 + TypeScript + Vite 6
- **Styling**: Tailwind CSS v4 + Custom HUD Scanline & CRT shaders
- **3D Graphics**: Three.js
- **Audio & Speech**: Web Audio API (`AudioContext`, `AnalyserNode`) + Web Speech API (`SpeechRecognition`, `SpeechSynthesis`) + Battery API
- **Icons**: Lucide React
