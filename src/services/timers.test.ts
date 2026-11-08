import { describe, expect, it } from 'vitest';
import { parseDirective } from './directives';
import { ReplyStreamProcessor } from './replyStream';
import {
  addTimer,
  cancelTimers,
  dismissRinging,
  doneAnnouncement,
  fireDue,
  formatRemaining,
  getTimers,
  matchTimers,
  ringingTimers,
} from './timers';

describe('SET_TIMER / CANCEL_TIMER parsing', () => {
  it('parses seconds and a label', () => {
    expect(parseDirective('SET_TIMER: 300 | pasta')).toEqual({ type: 'set-timer', seconds: 300, label: 'pasta' });
    expect(parseDirective('SET_TIMER:90|Tea')).toEqual({ type: 'set-timer', seconds: 90, label: 'Tea' });
  });

  it('drops a trailing "timer" from the label and defaults it', () => {
    expect(parseDirective('SET_TIMER: 600 | laundry timer')).toEqual({ type: 'set-timer', seconds: 600, label: 'laundry' });
    expect(parseDirective('SET_TIMER: 60')).toEqual({ type: 'set-timer', seconds: 60, label: 'timer' });
    expect(parseDirective('SET_TIMER: 60 | ')).toEqual({ type: 'set-timer', seconds: 60, label: 'timer' });
  });

  it('rejects bad durations', () => {
    expect(parseDirective('SET_TIMER: five minutes | eggs')).toBeNull();
    expect(parseDirective('SET_TIMER: 0 | eggs')).toBeNull();
    expect(parseDirective('SET_TIMER: -5 | eggs')).toBeNull();
    expect(parseDirective('SET_TIMER: 90000 | too long')).toBeNull();
    expect(parseDirective('SET_TIMER: 2.5 | eggs')).toBeNull();
  });

  it('parses CANCEL_TIMER with a label or all', () => {
    expect(parseDirective('CANCEL_TIMER: pasta')).toEqual({ type: 'cancel-timer', label: 'pasta' });
    expect(parseDirective('CANCEL_TIMER: pasta timer')).toEqual({ type: 'cancel-timer', label: 'pasta' });
    expect(parseDirective('CANCEL_TIMER: all')).toEqual({ type: 'cancel-timer', label: 'all' });
    expect(parseDirective('CANCEL_TIMER: ALL')).toEqual({ type: 'cancel-timer', label: 'all' });
    expect(parseDirective('CANCEL_TIMER:')).toBeNull();
  });

  it('keeps timer directives out of speech and subtitles, even when they stream in pieces', () => {
    const directives: string[] = [];
    const sentences: string[] = [];
    let display = '';
    const p = new ReplyStreamProcessor({ onDirective: (d) => directives.push(d), onSentence: (s) => sentences.push(s), onDisplay: (t) => (display = t) });
    for (const piece of ['SET_TI', 'MER: 300 | pas', 'ta\nCANCEL_TIMER: eggs\nTimer set for five minutes, sir.']) p.push(piece);
    p.end();
    expect(directives).toEqual(['SET_TIMER: 300 | pasta', 'CANCEL_TIMER: eggs']);
    expect(sentences).toEqual(['Timer set for five minutes, sir.']);
    expect(display).toBe('Timer set for five minutes, sir.');
  });
});

describe('timer store', () => {
  it('adds, fires, rings and dismisses', () => {
    cancelTimers('all');
    const t0 = 1_000_000;
    addTimer(60, 'pasta', t0);
    addTimer(120, 'eggs', t0);
    expect(getTimers().map((t) => t.label)).toEqual(['pasta', 'eggs']);
    expect(fireDue(t0 + 30_000)).toEqual([]);
    expect(fireDue(t0 + 61_000).map((t) => t.label)).toEqual(['pasta']);
    expect(fireDue(t0 + 62_000)).toEqual([]); // already ringing
    expect(ringingTimers().map((t) => t.label)).toEqual(['pasta']);
    expect(dismissRinging()).toBe(1);
    expect(getTimers().map((t) => t.label)).toEqual(['eggs']);
  });

  it('replaces a timer with the same label, cancels by label or all', () => {
    cancelTimers('all');
    addTimer(60, 'Pasta', 0);
    addTimer(300, 'pasta', 0);
    expect(getTimers()).toHaveLength(1);
    expect(getTimers()[0].durationMs).toBe(300_000);
    addTimer(60, 'boiled eggs', 0);
    expect(matchTimers(getTimers(), 'eggs').map((t) => t.label)).toEqual(['boiled eggs']);
    expect(cancelTimers('eggs')).toBe(1);
    expect(cancelTimers('nothing')).toBe(0);
    expect(cancelTimers('all')).toBe(1);
    expect(getTimers()).toEqual([]);
  });

  it('words the announcement naturally', () => {
    expect(doneAnnouncement(['pasta'])).toBe('Sir, your pasta timer is done.');
    expect(doneAnnouncement(['pasta', 'eggs'])).toBe('Sir, your pasta and eggs timers are done.');
    expect(doneAnnouncement(['timer'])).toBe('Sir, your timer is done.');
  });

  it('formats the countdown', () => {
    expect(formatRemaining(42_000)).toBe('0:42');
    expect(formatRemaining(245_000)).toBe('4:05');
    expect(formatRemaining(3_750_000)).toBe('1:02:30');
    expect(formatRemaining(-5)).toBe('0:00');
    expect(formatRemaining(400)).toBe('0:01');
  });
});
