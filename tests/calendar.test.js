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

  it("reads the n8n jarvis-calendar webhook's response", () => {
    const out = normalizeEvents({
      timeMin: '2026-11-08T07:00:00.000Z',
      timeMax: '2026-11-10T07:00:00.000Z',
      count: 3,
      events: [
        { id: 'a1', title: 'Call with Alex', start: '2026-11-08T10:30:00-07:00', end: '2026-11-08T11:00:00-07:00', allDay: false, location: 'Zoom', description: 'Notes', link: 'https://www.google.com/calendar/event?eid=x' },
        { id: 'a2', title: 'Veterans Day', start: '2026-11-09', end: '2026-11-10', allDay: true, location: '', description: '', link: '' },
        { id: 'a3', title: 'Dinner', start: '2026-11-08T18:00:00-07:00', end: '2026-11-08T20:00:00-07:00', allDay: false, location: 'Tsunami', description: '', link: '' },
      ],
    });
    expect(out).toEqual([
      { title: 'Veterans Day', start: '2026-11-09', end: '2026-11-10', allDay: true, location: '', calendar: '' },
      { title: 'Call with Alex', start: '2026-11-08T17:30:00.000Z', end: '2026-11-08T18:00:00.000Z', allDay: false, location: 'Zoom', calendar: '' },
      { title: 'Dinner', start: '2026-11-09T01:00:00.000Z', end: '2026-11-09T03:00:00.000Z', allDay: false, location: 'Tsunami', calendar: '' },
    ]);
  });

  it('skips junk and untitled events get a placeholder', () => {
    expect(normalizeEvents([null, 5, { summary: 'x' }, { start: { dateTime: 'not a date' } }])).toEqual([]);
    expect(normalizeEvents([{ start: '2026-11-09T16:00:00Z' }])[0].title).toBe('(No title)');
    expect(normalizeEvents([])).toEqual([]);
  });
});
