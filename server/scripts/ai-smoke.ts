// npm run ai:smoke -w server: one live call of each kind (JSON, text, image) with the .env models.
// The image is written to server/.cache/ai-smoke.<ext> so you can look at it.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUNDED, gemini } from '../src/ai/gemini';

const facts = { road: 'Capital Boulevard', hood: 'Five Points', stranded: 1200 };
if (!gemini.ready()) {
  console.log('GEMINI_API_KEY is not set: the game uses its templates.');
  process.exit(0);
}

let t = Date.now();
const headline = await gemini.json<{ headline: string }>({
  system: `You write one breaking-news headline from the facts.\n${GROUNDED}`,
  prompt: JSON.stringify(facts),
  schema: { type: 'object', properties: { headline: { type: 'string' } }, required: ['headline'] },
});
console.log(`json  ${Date.now() - t} ms`, headline);

t = Date.now();
const said = await gemini.text({ prompt: 'Say "ready" and nothing else.', maxChars: 40 });
console.log(`text  ${Date.now() - t} ms`, said);

t = Date.now();
const img = await gemini.image({ prompt: 'A flat two-color screen-print poster of a city street under flood water, bold ink outlines, no text.', aspectRatio: '1:1' });
const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', `ai-smoke.${img.mimeType.split('/')[1] ?? 'png'}`);
await mkdir(dirname(file), { recursive: true });
await writeFile(file, img.data);
console.log(`image ${Date.now() - t} ms`, img.model, img.mimeType, `${Math.round(img.data.length / 1024)} KB ->`, file);
