export interface JarvisCommandPayload {
  query: string;
  sessionId?: string;
  speaker?: string;
  speakerConfidence?: number;
  isAuthorizedOwner?: boolean;
}

export interface JarvisStreamOptions {
  /** Called with each new piece of reply text, in order. */
  onText?: (delta: string) => void;
  /** Abort the request (and stop reading the stream). */
  signal?: AbortSignal;
}

/**
 * n8n webhook. Override with VITE_JARVIS_WEBHOOK_URL, e.g. the streaming test endpoint
 * https://n8n.wolfcubventures.com/webhook/jarvis-command-stream
 */
export const JARVIS_WEBHOOK_URL =
  (import.meta.env.VITE_JARVIS_WEBHOOK_URL as string | undefined)?.trim() ||
  'https://n8n.wolfcubventures.com/webhook/jarvis-command';

/**
 * The n8n run failed: an HTTP error, or the stream ended with an "error" event and no reply
 * text after it. A dropped connection is not this error (it surfaces as a plain Error).
 * The message is generic on purpose: n8n's error content is raw backend detail.
 */
export class JarvisBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JarvisBackendError';
  }
}

const STREAM_TYPES = new Set(['begin', 'item', 'end', 'error']);

function buildPayload(payloadOrQuery: string | JarvisCommandPayload, defaultSessionId: string) {
  if (typeof payloadOrQuery === 'string') {
    return {
      query: payloadOrQuery.trim(),
      sessionId: defaultSessionId,
      speaker: 'Owner',
      speakerConfidence: 1.0,
      isAuthorizedOwner: true,
    };
  }
  return {
    query: payloadOrQuery.query.trim(),
    sessionId: payloadOrQuery.sessionId || defaultSessionId,
    speaker: payloadOrQuery.speaker || 'Unknown',
    speakerConfidence: payloadOrQuery.speakerConfidence ?? 0.85,
    isAuthorizedOwner: payloadOrQuery.isAuthorizedOwner ?? true,
  };
}

/** Legacy single-object reply: {"output": "..."} (or a few common alternatives). */
function extractLegacyText(body: string): string {
  try {
    let data: unknown = JSON.parse(body);
    if (Array.isArray(data)) data = data[0];
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      for (const key of ['output', 'response', 'message', 'text']) {
        if (typeof obj[key] === 'string') return obj[key] as string;
      }
    }
    return body;
  } catch {
    return body;
  }
}

function isStreamLine(line: string): boolean {
  try {
    const obj = JSON.parse(line);
    return !!obj && typeof obj === 'object' && STREAM_TYPES.has((obj as { type?: unknown }).type as string);
  } catch {
    return false;
  }
}

/**
 * POST a command to n8n and stream the reply text back through `onText`.
 *
 * - Non-JSON Content-Type (n8n "streaming" response mode): newline-delimited JSON
 *   {"type":"begin"|"item"|"end"|"error", "content"?: "..."}; the "content" of every item is
 *   concatenated. An "error" line (e.g. a failed tool) is logged and reading continues, since
 *   the agent usually goes on to explain the failure. If the stream ends with no item text after
 *   the last error, this throws JarvisBackendError.
 * - application/json: the old {"output": "..."} reply. As a safety net the body is still sniffed:
 *   if its first line is a stream event, it is parsed as a stream.
 *
 * Resolves with the full reply text. Logs time-to-first-chunk and total time.
 */
export async function streamJarvisCommand(
  payloadOrQuery: string | JarvisCommandPayload,
  options: JarvisStreamOptions = {},
  defaultSessionId = 'jarvis-web'
): Promise<string> {
  const { onText, signal } = options;
  const t0 = performance.now();
  let firstByteAt: number | null = null;
  let firstTextAt: number | null = null;
  let mode: 'stream' | 'legacy' | 'sniff' = 'sniff';
  let reply = '';
  /** An "error" event arrived and no item text has followed it yet */
  let errorUnanswered = false;

  const emit = (delta: string) => {
    if (!delta) return;
    if (firstTextAt === null) firstTextAt = performance.now();
    errorUnanswered = false;
    reply += delta;
    onText?.(delta);
  };

  const handleStreamLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: { type?: string; content?: unknown; metadata?: unknown };
    try {
      event = JSON.parse(trimmed);
    } catch {
      console.warn('[Jarvis Backend] Skipping unparseable stream line:', trimmed.slice(0, 200));
      return;
    }
    if (event.type === 'item') {
      if (typeof event.content === 'string') emit(event.content);
    } else if (event.type === 'error') {
      // Not fatal: a failed tool reports here and the agent then continues with a normal reply.
      // Never shown or spoken: the content is raw backend detail.
      const nodeName = (event.metadata as { nodeName?: unknown } | undefined)?.nodeName;
      console.warn(`[Jarvis Backend] n8n error event from ${String(nodeName ?? 'unknown node')}:`, event.content);
      errorUnanswered = true;
    }
    // begin / end: ignored (there can be several pairs when the agent calls tools)
  };

  const logTiming = (outcome: string) => {
    const ms = (t: number | null) => (t === null ? 'n/a' : `${Math.round(t - t0)}ms`);
    console.info(
      `[Jarvis Backend] ${outcome} mode=${mode} firstChunk=${ms(firstByteAt)} firstText=${ms(firstTextAt)} total=${ms(performance.now())} chars=${reply.length}`
    );
  };

  try {
    const res = await fetch(JARVIS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify(buildPayload(payloadOrQuery, defaultSessionId)),
      signal,
    });

    if (!res.ok) {
      throw new JarvisBackendError(`HTTP ${res.status}: ${res.statusText}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    mode = contentType.includes('application/json') ? 'sniff' : 'stream';

    if (!res.body) {
      // No streaming body support: fall back to reading it whole
      const text = await res.text();
      firstByteAt = performance.now();
      if (mode === 'stream' || text.split('\n').some(isStreamLine)) {
        mode = 'stream';
        text.split('\n').forEach(handleStreamLine);
        if (errorUnanswered) throw new JarvisBackendError('n8n run ended with an error and no reply');
      } else {
        mode = 'legacy';
        emit(extractLegacyText(text));
      }
      logTiming('done');
      return reply;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        if (firstByteAt === null) firstByteAt = performance.now();
        buffer += decoder.decode(value, { stream: true });

        if (mode === 'sniff') {
          // Decide from the first non-empty complete line
          const firstLine = buffer.split('\n').find((l, i, all) => i < all.length - 1 && l.trim());
          if (firstLine === undefined) continue;
          mode = isStreamLine(firstLine) ? 'stream' : 'legacy';
        }

        if (mode === 'stream') {
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep the trailing partial line
          for (const line of lines) handleStreamLine(line);
        }
        // legacy: keep buffering until the end
      }
      buffer += decoder.decode();

      if (mode === 'sniff') {
        mode = isStreamLine(buffer) ? 'stream' : 'legacy';
      }
      if (mode === 'stream') {
        buffer.split('\n').forEach(handleStreamLine);
      } else {
        emit(extractLegacyText(buffer));
      }
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }

    if (errorUnanswered) {
      throw new JarvisBackendError('n8n run ended with an error and no reply');
    }
    if (!reply.trim()) console.warn('[Jarvis Backend] Reply was empty');
    logTiming('done');
    return reply;
  } catch (err: unknown) {
    if (signal?.aborted) {
      logTiming('aborted');
      throw err;
    }
    logTiming('failed');
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Jarvis Backend Error]', errorMsg);
    if (err instanceof JarvisBackendError) throw err;
    throw new Error(`Command link failed: ${errorMsg}`);
  }
}

/** Non-streaming convenience wrapper: resolves with the full reply text. */
export async function sendJarvisCommand(
  payloadOrQuery: string | JarvisCommandPayload,
  defaultSessionId = 'jarvis-web'
): Promise<string> {
  return streamJarvisCommand(payloadOrQuery, {}, defaultSessionId);
}
