import { describe, expect, it } from 'vitest';
import { normalizeEvents } from '../api/calendar.js';

describe('calendar normalizeEvents', () => {
  it('reads Google Calendar events (timed and all-day), from n8n items too', () => {
    const out = normalizeEvents([
      { json: { summary: 'Dentist', start: { dateTime: '2026-11-08T15:30:00-07:00' }, end: { dateTime: '2026-11-08T16:00:00-07:00' }, location: 'Draper' } },
      { summary: 'Mom’s birthday', start: { date: '2026-11-08' }, end: { date: '2026-11-09' } },
      { summary: 'Cancelled thing', status: 'cancelled', start: { dateTime: '2026-11-08T10:00:00-07:00' } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Mom’s birthday', allDay: true, start: '2026-11-08', end: '2026-11-09' });
    expect(out[1]).toMatchObject({ title: 'Dentist', allDay: false, start: '2026-11-08T22:30:00.000Z', location: 'Draper' });
  });

  it('reads the simple shape and { events: [...] }', () => {
    const out = normalizeEvents({
      events: [
        { title: 'Standup', start: '2026-11-09T16:00:00Z', end: '2026-11-09T16:15:00Z' },
        { title: 'Holiday', start: '2026-11-10', allDay: true },
      ],
    });
    expect(out.map((e) => e.title)).toEqual(['Holiday', 'Standup']);
    expect(out[0].allDay).toBe(true);
  });

  it('skips junk and untitled events get a placeholder', () => {
    expect(normalizeEvents([null, 5, { summary: 'x' }, { start: { dateTime: 'not a date' } }])).toEqual([]);
    expect(normalizeEvents([{ start: '2026-11-09T16:00:00Z' }])[0].title).toBe('(No title)');
    expect(normalizeEvents([])).toEqual([]);
  });
});
