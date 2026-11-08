import { describe, expect, it } from 'vitest';
import { parseDirective, isScreenDirective, isHttpsUrl, normalizeCameraName } from './directives';
import { ReplyStreamProcessor, checkLeadingDirective, cleanForDisplay, stripDirectives } from './replyStream';

describe('parseDirective: YouTube', () => {
  it('parses PLAY_YOUTUBE with and without brackets', () => {
    expect(parseDirective('PLAY_YOUTUBE: dQw4w9WgXcQ')).toEqual({ type: 'youtube-video', videoId: 'dQw4w9WgXcQ' });
    expect(parseDirective('PLAY_YOUTUBE:[dQw4w9WgXcQ]')).toEqual({ type: 'youtube-video', videoId: 'dQw4w9WgXcQ' });
    expect(parseDirective('play_youtube: dQw4w9WgXcQ')).toEqual({ type: 'youtube-video', videoId: 'dQw4w9WgXcQ' });
  });

  it('rejects a PLAY_YOUTUBE id that is not 11 characters', () => {
    expect(parseDirective('PLAY_YOUTUBE: short')).toBeNull();
    expect(parseDirective('PLAY_YOUTUBE: dQw4w9WgXcQ123')).toBeNull();
  });

  it('parses PLAY_YOUTUBE_PLAYLIST', () => {
    expect(parseDirective('PLAY_YOUTUBE_PLAYLIST: PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toEqual({
      type: 'youtube-playlist',
      playlistId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    });
  });

  it('parses the playback controls, including the aliases', () => {
    expect(parseDirective('PAUSE_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'pause' });
    expect(parseDirective('RESUME_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'resume' });
    expect(parseDirective('STOP_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'stop' });
    expect(parseDirective('NEXT_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'next' });
    expect(parseDirective('YOUTUBE_NEXT')).toEqual({ type: 'youtube-control', action: 'next' });
    expect(parseDirective('PREV_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'prev' });
    expect(parseDirective('PREVIOUS_YOUTUBE')).toEqual({ type: 'youtube-control', action: 'prev' });
    expect(parseDirective('YOUTUBE_PREV')).toEqual({ type: 'youtube-control', action: 'prev' });
  });

  it('parses SET_VOLUME and clamps it to 100', () => {
    expect(parseDirective('SET_VOLUME: 40')).toEqual({ type: 'set-volume', volume: 40 });
    expect(parseDirective('SET_VOLUME: 250')).toEqual({ type: 'set-volume', volume: 100 });
    expect(parseDirective('SET_VOLUME: loud')).toBeNull();
  });
});

describe('parseDirective: screen', () => {
  it('parses SHOW_IMAGE and SHOW_VIDEO with https URLs', () => {
    expect(parseDirective('SHOW_IMAGE: https://example.com/a.jpg?x=1&y=2')).toEqual({
      type: 'show-image',
      url: 'https://example.com/a.jpg?x=1&y=2',
    });
    expect(parseDirective('SHOW_VIDEO: https://cdn.example.com/clip.mp4')).toEqual({
      type: 'show-video',
      url: 'https://cdn.example.com/clip.mp4',
    });
  });

  it('only accepts https URLs', () => {
    expect(parseDirective('SHOW_IMAGE: http://example.com/a.jpg')).toBeNull();
    expect(parseDirective('SHOW_IMAGE: javascript:alert(1)')).toBeNull();
    expect(parseDirective('SHOW_IMAGE: data:image/png;base64,AAAA')).toBeNull();
    expect(parseDirective('SHOW_VIDEO: //example.com/clip.mp4')).toBeNull();
    expect(parseDirective('SHOW_IMAGE:')).toBeNull();
  });

  it('parses SHOW_CAMERA names, including spaces', () => {
    expect(parseDirective('SHOW_CAMERA: driveway')).toEqual({ type: 'show-camera', camera: 'driveway' });
    expect(parseDirective('SHOW_CAMERA:  Front   Door ')).toEqual({ type: 'show-camera', camera: 'Front Door' });
  });

  it('parses several cameras, or all of them', () => {
    expect(parseDirective('SHOW_CAMERA: front door, blinds cam')).toEqual({ type: 'show-camera', camera: 'front door', cameras: ['front door', 'blinds cam'] });
    expect(parseDirective('SHOW_CAMERA: garage and driveway & porch')).toEqual({ type: 'show-camera', camera: 'garage', cameras: ['garage', 'driveway', 'porch'] });
    expect(parseDirective('SHOW_CAMERA: all')).toEqual({ type: 'show-camera', camera: 'all', cameras: ['all'] });
    expect(parseDirective('SHOW_CAMERA: All cameras')).toEqual({ type: 'show-camera', camera: 'all', cameras: ['all'] });
    expect(parseDirective('SHOW_CAMERA: blinds cam')).toEqual({ type: 'show-camera', camera: 'blinds cam' });
  });

  it('rejects camera names with unsafe characters', () => {
    expect(parseDirective('SHOW_CAMERA: ../etc/passwd')).toBeNull();
    expect(parseDirective('SHOW_CAMERA: a&b=c')).toBeNull();
    expect(parseDirective('SHOW_CAMERA: ')).toBeNull();
  });

  it('parses SHOW_IMAGE_SEARCH, with or without brackets/quotes', () => {
    expect(parseDirective('SHOW_IMAGE_SEARCH: snow leopard')).toEqual({ type: 'show-image-search', query: 'snow leopard' });
    expect(parseDirective('SHOW_IMAGE_SEARCH: [a fluffy sheep]')).toEqual({ type: 'show-image-search', query: 'a fluffy sheep' });
    expect(parseDirective('SHOW_IMAGE_SEARCH: "Eiffel Tower at night"')).toEqual({ type: 'show-image-search', query: 'Eiffel Tower at night' });
    expect(parseDirective('SHOW_IMAGE_SEARCH: ')).toBeNull();
    expect(parseDirective('SHOW_IMAGE_SEARCH: ' + 'x'.repeat(101))).toBeNull();
    expect(isScreenDirective(parseDirective('SHOW_IMAGE_SEARCH: cats')!)).toBe(true);
  });

  it('parses CLEAR_SCREEN', () => {
    expect(parseDirective('CLEAR_SCREEN')).toEqual({ type: 'clear-screen' });
  });

  it('separates screen directives from YouTube ones', () => {
    expect(isScreenDirective(parseDirective('CLEAR_SCREEN')!)).toBe(true);
    expect(isScreenDirective(parseDirective('SHOW_CAMERA: garage')!)).toBe(true);
    expect(isScreenDirective(parseDirective('PAUSE_YOUTUBE')!)).toBe(false);
  });

  it('returns null for unknown text', () => {
    expect(parseDirective('Good evening, sir.')).toBeNull();
    expect(parseDirective('SHOW_HOLOGRAM: x')).toBeNull();
  });

  it('helpers', () => {
    expect(isHttpsUrl('https://a.b/c')).toBe(true);
    expect(isHttpsUrl('ftp://a.b/c')).toBe(false);
    expect(normalizeCameraName('back_yard-2')).toBe('back_yard-2');
    expect(normalizeCameraName('x'.repeat(65))).toBeNull();
  });
});

/** Run a reply through the stream processor in the given pieces */
function run(pieces: string[]) {
  const directives: string[] = [];
  const sentences: string[] = [];
  let display = '';
  const p = new ReplyStreamProcessor({
    onDirective: (d) => directives.push(d),
    onSentence: (s) => sentences.push(s),
    onDisplay: (t) => (display = t),
  });
  pieces.forEach((x) => p.push(x));
  p.end();
  return { directives, sentences, display };
}

describe('ReplyStreamProcessor directives', () => {
  it('executes a leading PLAY_YOUTUBE and keeps it out of speech and subtitles', () => {
    const r = run(['PLAY_YOUTUBE: dQw4w9WgXcQ\nPlaying it now, sir.']);
    expect(r.directives).toEqual(['PLAY_YOUTUBE: dQw4w9WgXcQ']);
    expect(r.sentences).toEqual(['Playing it now, sir.']);
    expect(r.display).toBe('Playing it now, sir.');
  });

  it('handles stacked directives (SET_VOLUME then PLAY_YOUTUBE_PLAYLIST)', () => {
    const r = run(['SET_VOLUME: 30\nPLAY_YOUTUBE_PLAYLIST: PLabc123\nYour playlist, sir.']);
    expect(r.directives).toEqual(['SET_VOLUME: 30', 'PLAY_YOUTUBE_PLAYLIST: PLabc123']);
    expect(r.sentences).toEqual(['Your playlist, sir.']);
  });

  it('waits for a streamed URL to finish before executing SHOW_IMAGE', () => {
    const r = run(['SHOW_IM', 'AGE: https://exa', 'mple.com/photo', '.jpg\nHere is the photo', ', sir.']);
    expect(r.directives).toEqual(['SHOW_IMAGE: https://example.com/photo.jpg']);
    expect(parseDirective(r.directives[0])).toEqual({ type: 'show-image', url: 'https://example.com/photo.jpg' });
    expect(r.sentences).toEqual(['Here is the photo, sir.']);
    expect(r.display).toBe('Here is the photo, sir.');
  });

  it('keeps long URLs together (beyond the normal 80-character hold)', () => {
    const url = `https://images.example.com/${'a'.repeat(150)}.png?sig=${'b'.repeat(60)}`;
    const pieces = `SHOW_IMAGE: ${url}\nDone.`.match(/.{1,7}/gs)!;
    const r = run(pieces);
    expect(r.directives).toEqual([`SHOW_IMAGE: ${url}`]);
    expect(r.sentences).toEqual(['Done.']);
  });

  it('takes a camera name up to the end of its line, even if it arrives in pieces', () => {
    const r = run(['SHOW_CAMERA: front ', 'door\nHere is the front door, sir.']);
    expect(r.directives).toEqual(['SHOW_CAMERA: front door']);
    expect(parseDirective(r.directives[0])).toEqual({ type: 'show-camera', camera: 'front door' });
    expect(r.sentences).toEqual(['Here is the front door, sir.']);
  });

  it('waits for the whole SHOW_IMAGE_SEARCH line when it streams in', () => {
    const r = run(['SHOW_IMAGE', '_SEARCH: snow ', 'leopard\nA snow leopard, ', 'sir.']);
    expect(r.directives).toEqual(['SHOW_IMAGE_SEARCH: snow leopard']);
    expect(r.sentences).toEqual(['A snow leopard, sir.']);
    expect(r.display).toBe('A snow leopard, sir.');
  });

  it('handles SHOW_VIDEO and CLEAR_SCREEN', () => {
    expect(run(['SHOW_VIDEO: https://cdn.example.com/a.mp4\nRolling the footage.']).directives).toEqual([
      'SHOW_VIDEO: https://cdn.example.com/a.mp4',
    ]);
    const r = run(['CLEAR_SCREEN\nScreen cleared, sir.']);
    expect(r.directives).toEqual(['CLEAR_SCREEN']);
    expect(r.sentences).toEqual(['Screen cleared, sir.']);
  });

  it('a reply that is only a directive speaks nothing', () => {
    const r = run(['SHOW_CAMERA: garage']);
    expect(r.directives).toEqual(['SHOW_CAMERA: garage']);
    expect(r.sentences).toEqual([]);
    expect(r.display).toBe('');
  });

  it('does not treat ordinary text as a directive', () => {
    const r = run(['Show me what you have, sir.']);
    expect(r.directives).toEqual([]);
    expect(r.sentences).toEqual(['Show me what you have, sir.']);
  });

  it('strips directives that appear later in the reply and still executes them', () => {
    const r = run(['Right away, sir.\nSHOW_IMAGE: https://example.com/x.png\n']);
    expect(r.sentences).toEqual(['Right away, sir.']);
    expect(r.directives).toEqual(['SHOW_IMAGE: https://example.com/x.png']);
    expect(r.display).toBe('Right away, sir.');
  });
});

describe('stripping', () => {
  it('removes every directive kind from display text', () => {
    const text = 'PLAY_YOUTUBE: dQw4w9WgXcQ SET_VOLUME: 20 SHOW_IMAGE: https://a.b/c.jpg CLEAR_SCREEN Hello.';
    expect(cleanForDisplay(text)).toBe('Hello.');
    expect(stripDirectives('PAUSE_YOUTUBE now').trim()).toBe('now');
  });

  it('checkLeadingDirective reports pending for a partial keyword', () => {
    expect(checkLeadingDirective('SHOW_', false)).toEqual({ kind: 'pending' });
    expect(checkLeadingDirective('CLEAR_SCR', false)).toEqual({ kind: 'pending' });
    expect(checkLeadingDirective('Sure', false)).toEqual({ kind: 'none' });
  });
});
