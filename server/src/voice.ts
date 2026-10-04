// POST /api/tts (AGENTS.md): ElevenLabs speech for the briefing, the news anchor and alerts.
// Plain fetch to the REST API (no SDK dependency). Every clip is cached on disk by a hash of
// voice + model + text, so a replayed storm costs no credits and still plays when the API is down.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

export type Voice = 'broadcast' | 'narrator';

/** Premade ElevenLabs voices, used when the .env does not name others. */
const DEFAULT_VOICES: Record<Voice, string> = {
  broadcast: 'EXAVITQu4vr4xnSDxMaL', // Sarah: a calm news read
  narrator: 'JBFqnCBsd6RMkjVDRZzb', // George: a warm narrator
};
const MAX_CHARS = 600;
const TIMEOUT_MS = 20_000;
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'tts');

const voiceId = (v: Voice) =>
  (v === 'broadcast' ? process.env.ELEVENLABS_VOICE_BROADCAST : process.env.ELEVENLABS_VOICE_NARRATOR) || DEFAULT_VOICES[v];
const model = () => process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

export const voiceReady = () => !!process.env.ELEVENLABS_API_KEY;

export function registerVoice(app: FastifyInstance) {
  app.post<{ Body: { text?: unknown; voice?: unknown } }>('/api/tts', async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS) : '';
    const voice: Voice = req.body?.voice === 'narrator' ? 'narrator' : 'broadcast';
    if (!text) return reply.code(400).send({ error: 'text is required' });

    const id = voiceId(voice);
    const file = join(CACHE, `${createHash('sha256').update(`${id}|${model()}|${text}`).digest('hex')}.mp3`);
    try {
      const cached = await readFile(file);
      return reply.header('content-type', 'audio/mpeg').header('x-tts-cache', 'hit').send(cached);
    } catch {
      // not cached yet
    }

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return reply.code(503).send({ error: 'Voice is off. The game still works.' });
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        req.log.warn({ status: res.status }, 'ElevenLabs request failed');
        return reply.code(502).send({ error: `Voice service answered ${res.status}` });
      }
      const audio = Buffer.from(await res.arrayBuffer());
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, audio).catch(() => {});
      return reply.header('content-type', 'audio/mpeg').header('x-tts-cache', 'miss').send(audio);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'ElevenLabs unreachable');
      return reply.code(502).send({ error: 'Voice service unreachable' });
    }
  });
}
