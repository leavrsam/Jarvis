// Live (streaming) transcription with Deepgram Flux, a speech model built for voice assistants:
// it transcribes while you talk and decides when you've finished your turn (EndOfTurn) from what
// you said and how you said it, not only from silence. The text is ready the moment the turn
// ends, instead of after "wait for silence → upload the recording → transcribe".
//
// The browser connects to Deepgram directly with a short-lived token from /api/stt-token (the API
// key stays on the server).
import { notifyAuthRequired } from './auth';

const FLUX_URL =
  'wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000' +
  // End of turn: 0.7 is Deepgram's default; the timeout ends a turn after this long without a
  // confident end (e.g. trailing "umm...")
  '&eot_threshold=0.7&eot_timeout_ms=3000';

/** Flux works best with ~80 ms audio packets (1280 samples at 16 kHz) */
const PACKET_SAMPLES = 1280;
/** Audio held while the connection opens (more than this and something is wrong) */
const MAX_QUEUED_SAMPLES = 16000 * 20;
const TOKEN_REUSE_MS = 20_000; // tokens last 30 s; they only need to be valid when connecting

let cachedToken: { token: string; at: number } | null = null;
let tokenRequest: Promise<string> | null = null;
/** Set when the server can't issue tokens (no key, key lacks permission): don't keep trying */
let unavailableReason = '';

export function liveTranscriptionUnavailable(): string {
  return unavailableReason;
}

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/stt-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.status === 401) {
    notifyAuthRequired();
    throw new Error('not logged in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    if (data.error === 'not_configured' || data.error === 'token_rejected') {
      unavailableReason =
        data.error === 'not_configured'
          ? 'DEEPGRAM_API_KEY is not set'
          : `Deepgram refused a live-transcription token (HTTP ${data.status ?? '?'}${data.detail ? `: "${data.detail}"` : ''}). The key needs the Member role or higher`;
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.token as string;
}

/** Get a token (reusing a fresh one). Call early, e.g. when Jarvis starts talking, to save time. */
export function prefetchLiveToken(): Promise<string> {
  if (unavailableReason) return Promise.reject(new Error(unavailableReason));
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_REUSE_MS) return Promise.resolve(cachedToken.token);
  if (!tokenRequest) {
    tokenRequest = fetchToken()
      .then((token) => {
        cachedToken = { token, at: Date.now() };
        return token;
      })
      .finally(() => {
        tokenRequest = null;
      });
  }
  return tokenRequest;
}

function takeToken(): Promise<string> {
  // Use each token for one connection, then fetch the next in the background
  return prefetchLiveToken().then((token) => {
    if (cachedToken?.token === token) cachedToken = null;
    return token;
  });
}

export interface LiveTurnHandlers {
  /** Interim transcript of the turn in progress */
  onUpdate?: (transcript: string) => void;
  /** The speaker finished a turn (the connection stays open for another one) */
  onEndOfTurn: (transcript: string, trigger: string) => void;
  /** The connection failed or closed early; the caller should fall back */
  onError: (reason: string) => void;
}

/** One streaming session (one wake word / follow-up window). Audio in, turns out. */
export class LiveTurn {
  private ws: WebSocket | null = null;
  private queue: Int16Array[] = [];
  private queued = 0;
  private pending: number[] = [];
  private closed = false;
  private failed = false;
  readonly startedAt = Date.now();

  constructor(private readonly handlers: LiveTurnHandlers) {
    void this.connect();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get hasFailed(): boolean {
    return this.failed;
  }

  private fail(reason: string) {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.handlers.onError(reason);
    this.close();
  }

  private async connect() {
    let token: string;
    try {
      token = await takeToken();
    } catch (err) {
      this.fail(`token: ${(err as Error).message}`);
      return;
    }
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(FLUX_URL, ['bearer', token]);
    } catch (err) {
      this.fail(`connect: ${(err as Error).message}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      for (const packet of this.queue) ws.send(packet.buffer);
      this.queue = [];
      this.queued = 0;
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: { type?: string; event?: string; transcript?: string; trigger?: string; description?: string };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'Error') {
        this.fail(msg.description || 'stream error');
        return;
      }
      const transcript = (msg.transcript || '').trim();
      switch (msg.event) {
        case 'StartOfTurn':
        case 'Update':
        case 'TurnResumed':
          if (transcript) this.handlers.onUpdate?.(transcript);
          break;
        case 'EndOfTurn':
          this.handlers.onEndOfTurn(transcript, msg.trigger || 'model');
          break;
      }
    };
    ws.onerror = () => this.fail('connection error');
    ws.onclose = (e) => {
      if (!this.closed) this.fail(`connection closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
    };
  }

  /** Feed 16 kHz mono audio */
  send(samples: Float32Array) {
    if (this.closed || this.failed) return;
    for (let i = 0; i < samples.length; i++) this.pending.push(samples[i]);
    while (this.pending.length >= PACKET_SAMPLES) {
      const chunk = this.pending.splice(0, PACKET_SAMPLES);
      const packet = new Int16Array(PACKET_SAMPLES);
      for (let i = 0; i < PACKET_SAMPLES; i++) packet[i] = Math.max(-1, Math.min(1, chunk[i])) * 0x7fff;
      if (this.isOpen) {
        this.ws!.send(packet.buffer);
      } else {
        this.queue.push(packet);
        this.queued += PACKET_SAMPLES;
        if (this.queued > MAX_QUEUED_SAMPLES) this.fail('connection too slow');
      }
    }
  }

  /** End the current turn now (Flux replies with EndOfTurn, trigger "manual") */
  forceEndTurn() {
    if (this.isOpen) this.ws!.send(JSON.stringify({ type: 'ForceEndTurn' }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {}
    try {
      ws.close();
    } catch {}
  }
}
