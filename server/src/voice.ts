// POST /api/tts (AGENTS.md): ElevenLabs speech for the briefing, the news anchors and alerts.
// Plain fetch to the REST API (no SDK dependency). Every clip is cached on disk by a hash of
// voice + model + text, so a replayed storm costs no credits and still plays when the API is down.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

/** The briefing narrator, the original anchor, and the two news channels (app/src/news.ts). */
export type Voice = 'broadcast' | 'narrator' | 'america' | 'bharat';
const VOICES: readonly Voice[] = ['broadcast', 'narrator', 'america', 'bharat'];

/**
 * Premade ElevenLabs voices: used when the .env names none, or when ElevenLabs refuses the one it
 * names. The anchors match their portraits (app/public/anchors/): America News is read by a woman,
 * Bharat News by a man.
 */
const DEFAULT_VOICES: Record<Voice, string> = {
  broadcast: 'EXAVITQu4vr4xnSDxMaL', // Sarah: a calm news read
  narrator: 'JBFqnCBsd6RMkjVDRZzb', // George: a warm narrator
  america: 'EXAVITQu4vr4xnSDxMaL', // Sarah (female), for America News
  bharat: 'JBFqnCBsd6RMkjVDRZzb', // George (male), speaking Hindi, for Bharat News
};
/** Where each voice's id comes from. Only its own variable, so no other voice stands in for an anchor. */
const ENV: Record<Voice, string[]> = {
  broadcast: ['ELEVENLABS_VOICE_BROADCAST'],
  narrator: ['ELEVENLABS_VOICE_NARRATOR'],
  america: ['ELEVENLABS_VOICE_AMERICA'],
  bharat: ['ELEVENLABS_VOICE_BHARAT'],
};
/** The language each voice speaks (ISO 639-1) and its pace: the news reads a little brisker. */
const LANG: Record<Voice, string> = { broadcast: 'en', narrator: 'en', america: 'en', bharat: 'hi' };
const SPEED: Record<Voice, number> = { broadcast: 1, narrator: 1, america: 1.1, bharat: 1.1 };

const MAX_CHARS = 600;
const TIMEOUT_MS = 20_000;
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'tts');
/** Statuses that mean "not this voice" (a library voice on the free plan answers 402). */
const REFUSED = new Set([400, 401, 402, 403, 404, 422]);
/** Voice ids ElevenLabs refused since the server started: they go straight to the default. */
const refused = new Set<string>();

const model = () => process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const configured = (v: Voice) => ENV[v].map((name) => process.env[name]?.trim()).find((id) => !!id) ?? null;

export const voiceReady = () => !!process.env.ELEVENLABS_API_KEY;

/** The cache file for one clip. English at normal pace keeps the original key, so old clips still hit. */
function cacheFile(id: string, voice: Voice, text: string) {
  const extra = LANG[voice] !== 'en' || SPEED[voice] !== 1 ? `|${LANG[voice]}|${SPEED[voice]}` : '';
  return join(CACHE, `${createHash('sha256').update(`${id}|${model()}|${text}${extra}`).digest('hex')}.mp3`);
}

function requestBody(voice: Voice, text: string) {
  return JSON.stringify({
    text,
    model_id: model(),
    // Makes the model speak (and read numbers in) the channel's language. Multilingual v2 rejects it.
    ...(LANG[voice] !== 'en' && !/multilingual_v2/.test(model()) ? { language_code: LANG[voice] } : {}),
    ...(SPEED[voice] !== 1 ? { voice_settings: { speed: SPEED[voice] } } : {}),
  });
}

export function registerVoice(app: FastifyInstance) {
  app.post<{ Body: { text?: unknown; voice?: unknown } }>('/api/tts', async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS) : '';
    const asked = req.body?.voice;
    const voice: Voice = VOICES.includes(asked as Voice) ? (asked as Voice) : 'broadcast';
    if (!text) return reply.code(400).send({ error: 'text is required' });

    const fromEnv = configured(voice);
    const ids = [...new Set([fromEnv && !refused.has(fromEnv) ? fromEnv : null, DEFAULT_VOICES[voice]].filter((x): x is string => !!x))];
    for (const id of ids) {
      try {
        const cached = await readFile(cacheFile(id, voice, text));
        return reply.header('content-type', 'audio/mpeg').header('x-tts-cache', 'hit').send(cached);
      } catch {
        // not cached for this voice
      }
    }

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return reply.code(503).send({ error: 'Voice is off. The game still works.' });
    let status = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: requestBody(voice, text),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          status = res.status;
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          if (id === fromEnv && REFUSED.has(res.status)) {
            refused.add(id);
            req.log.warn({ status, voice, env: ENV[voice][0], detail }, 'ElevenLabs refused the voice in .env; using the default voice');
            continue;
          }
          req.log.warn({ status, voice, detail }, 'ElevenLabs request failed');
          break;
        }
        const audio = Buffer.from(await res.arrayBuffer());
        await mkdir(CACHE, { recursive: true });
        await writeFile(cacheFile(id, voice, text), audio).catch(() => {});
        return reply.header('content-type', 'audio/mpeg').header('x-tts-cache', 'miss').send(audio);
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, 'ElevenLabs unreachable');
        return reply.code(502).send({ error: 'Voice service unreachable' });
      }
    }
    return reply.code(502).send({ error: `Voice service answered ${status}` });
  });
}
