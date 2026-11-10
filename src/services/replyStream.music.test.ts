import { describe, expect, it } from 'vitest';
import { ReplyStreamProcessor } from './replyStream';

describe('music directives in a streamed reply', () => {
  it('runs PLAY_RADIO and never speaks it, even when it arrives in pieces', () => {
    const directives: string[] = [];
    const sentences: string[] = [];
    const p = new ReplyStreamProcessor({ onDirective: (d) => directives.push(d), onSentence: (s) => sentences.push(s) });
    for (const piece of ['PLAY_RA', 'DIO: lofi hip', ' hop\nPutting on some lofi', ', sir.']) p.push(piece);
    p.end();
    expect(directives).toEqual(['PLAY_RADIO: lofi hip hop']);
    expect(sentences).toEqual(['Putting on some lofi, sir.']);
  });
});
