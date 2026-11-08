import { describe, expect, it } from 'vitest';
import { parseNotification } from '../api/push.js';

const noHeaders = () => '';
const headers = (h) => (...names) => {
  for (const n of names) if (h[n] !== undefined) return h[n];
  return '';
};

describe('parseNotification', () => {
  it('reads n8n JSON', () => {
    const n = parseNotification(JSON.stringify({ title: 'Laundry', message: 'Done', priority: 4, url: '/x', speak: true, tag: 'laundry', tags: ['home'] }), 'application/json', noHeaders);
    expect(n).toEqual({ title: 'Laundry', body: 'Done', url: '/x', priority: 4, tags: ['home'], tag: 'laundry', speak: true });
  });
  it('accepts ntfy-style plain text with headers', () => {
    const n = parseNotification('Someone is at the door', 'text/plain', headers({ Title: 'Door', Priority: 'urgent', Tags: 'door,warning', Click: 'https://example.com/cam' }));
    expect(n).toMatchObject({ title: 'Door', body: 'Someone is at the door', priority: 5, tags: ['door', 'warning'], url: 'https://example.com/cam' });
  });
  it('accepts ntfy JSON field names and priority words', () => {
    const n = parseNotification(JSON.stringify({ topic: 'x', message: 'Hi', click: '/', priority: 'low' }), 'application/json', noHeaders);
    expect(n).toMatchObject({ title: 'Jarvis', body: 'Hi', priority: 2 });
  });
  it('drops unsafe links, clamps priority and trims long text', () => {
    const n = parseNotification(JSON.stringify({ title: 'T', body: 'x'.repeat(5000), url: 'javascript:alert(1)', priority: 99 }), 'application/json', noHeaders);
    expect(n.url).toBe('/');
    expect(n.priority).toBe(5);
    expect(n.body.length).toBe(1000);
  });
  it('rejects empty or malformed bodies', () => {
    expect(parseNotification('{}', 'application/json', noHeaders)).toBeNull();
    expect(parseNotification('{not json', 'application/json', noHeaders)).toBeNull();
    expect(parseNotification('[1,2]', 'application/json', noHeaders)).toBeNull();
  });
});
