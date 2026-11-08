// "Stop" as a whole command: handled on the device (Jarvis just stops, no reply), never sent to
// n8n. Only when it's the entire utterance, so "stop the music" or "cancel my 3 pm meeting"
// still go to n8n as normal requests.
const STOP_WORDS =
  "stop|stop it|stop that|stop talking|cancel|cancel that|cancel it|never ?mind|forget it|forget about it|quiet|be quiet|quiet please|shut up|hush|silence|enough|that's enough|thats enough|that is enough|halt|abort|nothing|no stop";

const STOP_COMMAND = new RegExp(
  // optional "hey/ok Jarvis", "Jarvis", "okay", "no", "please" around it
  `^\\W*(?:(?:hey|hi|ok|okay|yo)\\W+)?(?:jarvis\\W+)?(?:(?:ok|okay|no|please|just|oh)\\W+)*(?:${STOP_WORDS})(?:\\W+(?:please|now|jarvis|thanks|thank you|already|right now))*\\W*$`,
  'i'
);

export function isStopCommand(text: string): boolean {
  return STOP_COMMAND.test(text.trim());
}
