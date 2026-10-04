// ElevenLabs speech through the server (POST /api/tts), fail soft (AGENTS.md rule 4): when the
// server, the key or sound is off, nothing plays and the captions carry the words.
import { create } from 'zustand';
import { audioRunning, playClip, useSound, type Clip } from './sound';

export type VoiceName = 'broadcast' | 'narrator';

const enabled = import.meta.env.VITE_FEATURE_VOICE !== 'false';
const clips = new Map<string, Promise<ArrayBuffer>>();
let health: Promise<boolean> | null = null;

/** Whether the server can speak (checked once per page). */
function serverVoice(): Promise<boolean> {
  health ??= fetch('/api/health')
    .then((r) => (r.ok ? r.json() : { voice: false }))
    .then((j: { voice?: boolean }) => !!j.voice)
    .catch(() => false);
  return health;
}

function fetchClip(text: string, voice: VoiceName): Promise<ArrayBuffer> {
  const key = `${voice}|${text}`;
  let p = clips.get(key);
  if (!p) {
    p = fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) }).then((r) => {
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => clips.delete(key));
    clips.set(key, p);
  }
  return p;
}

/** What is being said now, for captions and the anchor's mouth. */
export const useVoice = create<{ line: string | null; clip: Clip | null }>(() => ({ line: null, clip: null }));

/** Start loading lines that will be spoken soon, so they play without a gap. */
export async function prefetchSpeech(lines: string[], voice: VoiceName = 'broadcast') {
  if (!enabled || !useSound.getState().on || !(await serverVoice())) return;
  for (const line of lines) fetchClip(line, voice).catch(() => {});
}

let token = 0;

/**
 * Say `text`. Resolves when it has finished (or at once when there is no voice). The caption
 * (useVoice.line) is set either way, so the words are on screen with or without sound.
 */
export async function say(text: string, voice: VoiceName = 'broadcast'): Promise<void> {
  const my = ++token;
  useVoice.getState().clip?.stop();
  useVoice.setState({ line: text, clip: null });
  const done = () => my === token && useVoice.setState({ line: null, clip: null });
  if (!enabled || !audioRunning() || !(await serverVoice())) {
    // No voice: leave the caption up for about as long as it would take to say.
    await new Promise((r) => setTimeout(r, 900 + text.length * 55));
    return void done();
  }
  try {
    const clip = await playClip(await fetchClip(text, voice));
    if (!clip) return void done();
    if (my !== token) return clip.stop();
    useVoice.setState({ clip });
    await clip.ended;
  } catch {
    // The server or ElevenLabs is down: the caption still shows.
    await new Promise((r) => setTimeout(r, 900 + text.length * 55));
  }
  done();
}

/** Stop talking (leaving a phase, muting). */
export function hush() {
  token++;
  useVoice.getState().clip?.stop();
  useVoice.setState({ line: null, clip: null });
}
