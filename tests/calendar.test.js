import { describe, expect, it } from 'vitest';
import { normalizeCalendarErrors, normalizeCalendars, normalizeEvents } from '../api/calendar.js';

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
      { title: 'Veterans Day', start: '2026-11-09', end: '2026-11-10', allDay: true, location: '', calendar: '', calendarId: '', color: '' },
      { title: 'Call with Alex', start: '2026-11-08T17:30:00.000Z', end: '2026-11-08T18:00:00.000Z', allDay: false, location: 'Zoom', calendar: '', calendarId: '', color: '' },
      { title: 'Dinner', start: '2026-11-09T01:00:00.000Z', end: '2026-11-09T03:00:00.000Z', allDay: false, location: 'Tsunami', calendar: '', calendarId: '', color: '' },
    ]);
  });

  it('skips junk and untitled events get a placeholder', () => {
    expect(normalizeEvents([null, 5, { summary: 'x' }, { start: { dateTime: 'not a date' } }])).toEqual([]);
    expect(normalizeEvents([{ start: '2026-11-09T16:00:00Z' }])[0].title).toBe('(No title)');
    expect(normalizeEvents([])).toEqual([]);
  });

  it('keeps each event’s calendar and a safe colour', () => {
    const [e] = normalizeEvents({
      events: [{ title: 'Soccer', start: '2026-11-08T17:00:00Z', calendarId: 'family#x@group.calendar.google.com', calendarName: 'Family', color: '#16A765' }],
    });
    expect(e).toMatchObject({ calendar: 'Family', calendarId: 'family#x@group.calendar.google.com', color: '#16A765' });
    const [bad] = normalizeEvents({ events: [{ title: 'x', start: '2026-11-08T17:00:00Z', color: 'red;background:url(x)' }] });
    expect(bad.color).toBe('');
  });
});

describe('calendar list', () => {
  it('normalises the mode=calendars response, primary first', () => {
    const out = normalizeCalendars({
      calendars: [
        { id: 'en.usa#holiday@group.v.calendar.google.com', name: 'Holidays', color: '#16a765', primary: false, selectedInGoogle: false, accessRole: 'reader' },
        { id: 'sam@example.com', name: 'Samuel', color: '#4986e7', primary: true, selectedInGoogle: true, accessRole: 'owner' },
        { id: 'abc@group.calendar.google.com', name: 'Family', color: '#f83a22', primary: false, selectedInGoogle: true },
        { id: 'bad id with spaces', name: 'Nope' },
      ],
    });
    expect(out.map((c) => c.name)).toEqual(['Samuel', 'Family', 'Holidays']);
    expect(out[0]).toEqual({ id: 'sam@example.com', name: 'Samuel', color: '#4986e7', primary: true, selectedInGoogle: true });
    expect(out[2].selectedInGoogle).toBe(false);
  });

  it('turns calendarErrors into names', () => {
    expect(normalizeCalendarErrors(['Work', { name: 'Family', error: 'x' }, { calendarId: 'abc@x' }, 7])).toEqual(['Work', 'Family', 'abc@x']);
    expect(normalizeCalendarErrors(undefined)).toEqual([]);
  });
});
