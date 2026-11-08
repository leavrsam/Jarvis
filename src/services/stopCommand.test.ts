import { describe, expect, it } from 'vitest';
import { isStopCommand } from './stopCommand';

describe('isStopCommand', () => {
  it('matches "stop" said on its own, however it is phrased', () => {
    for (const t of ['stop', 'Stop.', 'Stop!', 'Jarvis, stop', 'Hey Jarvis, stop.', 'stop it', 'Stop talking', 'cancel', 'Cancel that.', 'never mind', 'Nevermind', 'forget it', 'be quiet', 'shut up', "That's enough.", 'enough', 'ok stop', 'no, stop', 'please stop', 'stop please', 'Stop, Jarvis.', 'Stop now', 'just stop'])
      expect(isStopCommand(t), t).toBe(true);
  });
  it('leaves real requests alone', () => {
    for (const t of ['stop the music', 'Stop the timer', 'cancel my 3 pm meeting', 'Never mind the weather, what time is it?', 'Is there a bus stop nearby?', "Don't stop", 'quiet hours tonight', 'What does halt mean?', 'stop playing', 'enough water for two'])
      expect(isStopCommand(t), t).toBe(false);
  });
});
