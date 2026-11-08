/**
 * Turns a reply that arrives in pieces into:
 *  - leading directives (PLAY_YOUTUBE: <id>, SET_VOLUME: 40, SHOW_IMAGE: <url>, ... see directives.ts)
 *  - complete sentences, released as soon as each one ends, for sentence-level TTS
 *  - a clean display string for the on-screen transcript
 *
 * Pure logic with no DOM or audio dependencies.
 */

import { ANY_DIRECTIVE_RE, ARG_KEYWORDS, DIRECTIVE_KEYWORDS, LEADING_DIRECTIVE_RE } from './directives';

export interface ReplyStreamHandlers {
  /** A directive to execute, e.g. "PLAY_YOUTUBE: dQw4w9WgXcQ". */
  onDirective?: (directive: string) => void;
  /** One complete sentence, ready for TTS. May still contain <short pause> tags. */
  onSentence?: (sentence: string) => void;
  /** The whole reply so far, cleaned for display. */
  onDisplay?: (text: string) => void;
}

export const PAUSE_TAG_RE = /<\s*(?:short|medium|long)?\s*pause\s*>/gi;

/** Never hold the reply back longer than this while deciding whether it starts with a directive. */
const MAX_DIRECTIVE_HOLD = 80;
/** SHOW_IMAGE / SHOW_VIDEO lines carry URLs, which can be long */
const MAX_URL_DIRECTIVE_HOLD = 2048;

// Words that end in "." without ending a sentence
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'no', 'vol', 'fig',
]);

export function stripDirectives(text: string): string {
  return text.replace(ANY_DIRECTIVE_RE, ' ');
}

export function stripPauseTags(text: string, replacement = ' '): string {
  return text.replace(PAUSE_TAG_RE, replacement);
}

/** Display form: no directives, no pause tags, no half-received tag at the end. */
export function cleanForDisplay(text: string): string {
  return stripPauseTags(stripDirectives(text))
    .replace(/<[^>\n]{0,40}$/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

type DirectiveCheck = { kind: 'directive'; length: number } | { kind: 'pending' } | { kind: 'none' };

/** Decide whether `text` (already left-trimmed) starts with a directive. */
export function checkLeadingDirective(text: string, final: boolean): DirectiveCheck {
  const match = LEADING_DIRECTIVE_RE.exec(text);
  if (match) {
    const end = match[0].length;
    // A camera name / image search runs to the end of its line, which may not have arrived yet
    if (!final && /^SHOW_(?:CAMERA|IMAGE_SEARCH)/i.test(match[0]) && !text.slice(end).includes('\n')) return { kind: 'pending' };
    // The id/number may still be arriving unless something follows it (or the stream is over)
    const next = text[end];
    if (next === undefined && !final) return { kind: 'pending' };
    if (next === undefined || !/[A-Za-z0-9_\-\]]/.test(next)) return { kind: 'directive', length: end };
    // e.g. "PLAY_YOUTUBE" followed by "_PLAYLIST..." is handled by the alternation order; anything else is not a directive
  }
  if (final) return { kind: 'none' };

  const word = (/^[A-Za-z_]*/.exec(text)?.[0] ?? '').toUpperCase();
  if (word.length === text.length) {
    // Only letters so far: could still become a keyword
    return DIRECTIVE_KEYWORDS.some((k) => k.startsWith(word)) ? { kind: 'pending' } : { kind: 'none' };
  }
  if (ARG_KEYWORDS.has(word)) {
    // Keyword complete, argument still arriving
    const rest = text.slice(word.length);
    if (/^:?\s*\[?[A-Za-z0-9_-]*$/.test(rest)) return { kind: 'pending' };
    if (word.startsWith('SHOW_') && /^:[ \t]*\S*$/.test(rest)) return { kind: 'pending' };
  }
  return { kind: 'none' };
}

/** Index just past the first complete sentence in `text`, or -1 if none is complete yet. */
export function findSentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      if (text.slice(0, i).trim()) return i + 1;
      continue;
    }
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    let j = i + 1;
    while (j < text.length && /["'”’)\]]/.test(text[j])) j++;
    if (j >= text.length || !/\s/.test(text[j])) continue; // need a space after the sentence end

    if (ch === '.') {
      const before = text.slice(0, i);
      const lastWord = (/(\S+)$/.exec(before)?.[1] ?? '').replace(/^["'(\[]+/, '').toLowerCase();
      if (ABBREVIATIONS.has(lastWord)) continue;
      // Single initials ("J. R. R.") and list markers at the start of a line ("1. ")
      if (/^[a-z]$/i.test(lastWord)) continue;
      if (/^\d+$/.test(lastWord) && /(^|\n)\s*\d+$/.test(before)) continue;
    }
    return j + 1;
  }
  return -1;
}

export class ReplyStreamProcessor {
  private raw = '';
  private detecting = true;
  /** Where the spoken/displayed body starts (after any leading directives) */
  private bodyStart = 0;
  /** How far into `raw` sentences have been released */
  private emitted = 0;
  private ended = false;
  private lastDisplay = '';

  constructor(private readonly handlers: ReplyStreamHandlers = {}) {}

  push(delta: string) {
    if (this.ended || !delta) return;
    this.raw += delta;
    this.process(false);
  }

  end() {
    if (this.ended) return;
    this.process(true);
    this.ended = true;
    // Directives that appear later in the reply (old non-streaming behaviour supported these too)
    const body = this.raw.slice(this.bodyStart);
    for (const m of body.matchAll(ANY_DIRECTIVE_RE)) {
      this.handlers.onDirective?.(m[0]);
    }
  }

  /** The reply as it should appear on screen. */
  get displayText(): string {
    return this.detecting ? '' : cleanForDisplay(this.raw.slice(this.bodyStart));
  }

  private process(final: boolean) {
    if (this.detecting) {
      while (true) {
        const rest = this.raw.slice(this.bodyStart);
        const lead = rest.length - rest.trimStart().length;
        const text = rest.slice(lead);
        if (!text && !final) return;

        let check = checkLeadingDirective(text, final);
        const hold = /^SHOW_/i.test(text) ? MAX_URL_DIRECTIVE_HOLD : MAX_DIRECTIVE_HOLD;
        if (check.kind === 'pending' && text.length > hold) check = { kind: 'none' };
        if (check.kind === 'pending') return;
        if (check.kind === 'directive') {
          this.handlers.onDirective?.(text.slice(0, check.length));
          this.bodyStart += lead + check.length;
          continue; // directives can be stacked, e.g. SET_VOLUME then PLAY_YOUTUBE
        }
        this.detecting = false;
        this.bodyStart += lead;
        this.emitted = this.bodyStart;
        break;
      }
    }

    while (true) {
      const pending = this.raw.slice(this.emitted);
      const end = findSentenceEnd(pending);
      if (end < 0) break;
      this.emitSentence(pending.slice(0, end));
      this.emitted += end;
    }
    if (final && this.emitted < this.raw.length) {
      this.emitSentence(this.raw.slice(this.emitted));
      this.emitted = this.raw.length;
    }

    const display = this.displayText;
    if (display !== this.lastDisplay) {
      this.lastDisplay = display;
      this.handlers.onDisplay?.(display);
    }
  }

  private emitSentence(chunk: string) {
    const sentence = stripDirectives(chunk).replace(/\s+/g, ' ').trim();
    // Skip chunks that are nothing but pause tags / punctuation
    if (!/[A-Za-z0-9]/.test(stripPauseTags(sentence))) return;
    this.handlers.onSentence?.(sentence);
  }
}
