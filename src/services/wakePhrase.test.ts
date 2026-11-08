import { describe, expect, it } from 'vitest';
import { startsWithWakePhrase, stripWakePhrase } from './wakePhrase';

describe('stripWakePhrase', () => {
  it('removes the wake phrase however it is punctuated', () => {
    expect(stripWakePhrase('Hey, Jarvis.')).toBe('');
    expect(stripWakePhrase('Hey Jarvis')).toBe('');
    expect(stripWakePhrase('hey jarvis!')).toBe('');
    expect(stripWakePhrase('Jarvis?')).toBe('');
    expect(stripWakePhrase('Okay, Jarvis -')).toBe('');
  });

  it('keeps the command that follows', () => {
    expect(stripWakePhrase("Hey, Jarvis. What's the weather today?")).toBe("What's the weather today?");
    expect(stripWakePhrase('Hey Jarvis, what time is it?')).toBe('what time is it?');
    expect(stripWakePhrase('Jarvis, lights off.')).toBe('lights off.');
  });

  it('leaves other text alone', () => {
    expect(stripWakePhrase('What time is it?')).toBe('What time is it?');
    expect(stripWakePhrase('Hey there, how are you?')).toBe('Hey there, how are you?');
    expect(stripWakePhrase('Jarvisville is a town')).toBe('Jarvisville is a town');
    expect(startsWithWakePhrase('The time. What time is it?')).toBe(false);
    expect(startsWithWakePhrase('Hey, Jarvis. Stop.')).toBe(true);
  });
});
