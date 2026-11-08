import { describe, expect, it } from 'vitest';
import { commandAfterWakePhrase, jarvisCheck, startsWithWakePhrase, stripWakePhrase } from './wakePhrase';

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

describe('jarvisCheck (plain "Jarvis" wake confirmation)', () => {
  it('accepts transcripts that start with Jarvis', () => {
    for (const t of ['Jarvis', 'Jarvis.', 'Jarvis, turn on the lights.', 'jarvis what time is it', 'Hey, Jarvis!', 'OK Jarvis play music', 'Jervis, lights'])
      expect(jarvisCheck(t, true)).toBe('yes');
  });
  it('rejects the sound-alikes the detector can confuse with it', () => {
    for (const t of ['Travis is here', 'Hey Travis.', 'Jars of pickles', 'Harvest festival', 'Service please', 'Nervous', 'I told Jarvis', ''])
      expect(jarvisCheck(t, true)).toBe('no');
  });
  it('waits on partial live transcripts that could still become Jarvis', () => {
    for (const t of ['', 'Ja', 'Jar', 'Jarv', 'Hey', 'Hey jar']) expect(jarvisCheck(t, false)).toBe('wait');
    for (const t of ['Jars', 'Travis', 'Hey Travis', 'Can you', 'Jar of']) expect(jarvisCheck(t, false)).toBe('no');
  });
});


describe('commandAfterWakePhrase', () => {
  it('drops other people’s talk before the wake phrase', () => {
    expect(commandAfterWakePhrase("So I told him no. Hey, Jarvis. What's the weather?")).toEqual({ command: "What's the weather?", hadWakePhrase: true });
    expect(commandAfterWakePhrase('yeah totally hey jarvis turn off the lights')).toEqual({ command: 'turn off the lights', hadWakePhrase: true });
    expect(commandAfterWakePhrase('Right. Jarvis, what time is it?')).toEqual({ command: 'what time is it?', hadWakePhrase: true });
  });

  it('handles a wake phrase at the start, or none at all', () => {
    expect(commandAfterWakePhrase('Hey Jarvis, play some music')).toEqual({ command: 'play some music', hadWakePhrase: true });
    expect(commandAfterWakePhrase('And what about tomorrow?')).toEqual({ command: 'And what about tomorrow?', hadWakePhrase: false });
  });

  it('does not treat a person called Travis as the wake word', () => {
    expect(commandAfterWakePhrase('Ask Travis about tomorrow').hadWakePhrase).toBe(false);
    expect(commandAfterWakePhrase('Ask Travis about tomorrow').command).toBe('Ask Travis about tomorrow');
  });
});
