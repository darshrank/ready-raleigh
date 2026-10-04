import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { AIError, Gemini, type GenerateClient } from './gemini';

type Call = { model: string; contents: string; config?: Record<string, unknown> };

/** A fake SDK client: `answer` decides each call's response (or throws). */
function fake(answer: (call: Call, n: number) => unknown) {
  const calls: Call[] = [];
  const client: GenerateClient = {
    models: {
      async generateContent(req) {
        const call = { model: req.model, contents: req.contents, config: req.config as Record<string, unknown> };
        calls.push(call);
        return answer(call, calls.length) as never;
      },
    },
  };
  return { client, calls };
}
const textResponse = (text: string) => ({ text, candidates: [{ content: { parts: [{ text }] } }] });
const schema = { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] };

describe('Gemini harness', () => {
  it('is not ready without a key, and says so instead of calling', async () => {
    const g = new Gemini({ apiKey: '' });
    expect(g.ready()).toBe(false);
    await expect(g.text({ prompt: 'hi' })).rejects.toThrow(/not configured/);
  });

  it('asks for JSON against the schema, with thinking off, and parses the answer', async () => {
    const { client, calls } = fake(() => textResponse('{"line":"Crabtree Creek rises"}'));
    const g = new Gemini({ client, textModels: ['m1'] });
    expect(await g.json<{ line: string }>({ system: 'sys', prompt: '{}', schema })).toEqual({ line: 'Crabtree Creek rises' });
    expect(calls[0]!.model).toBe('m1');
    expect(calls[0]!.config).toMatchObject({
      systemInstruction: 'sys',
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('rejects malformed JSON, missing fields and failed checks as AIError', async () => {
    const bad = new Gemini({ client: fake(() => textResponse('not json')).client, textModels: ['m'] });
    await expect(bad.json({ prompt: '', schema })).rejects.toBeInstanceOf(AIError);
    const missing = new Gemini({ client: fake(() => textResponse('{}')).client, textModels: ['m'] });
    await expect(missing.json({ prompt: '', schema })).rejects.toThrow(/missing line/);
    const long = new Gemini({ client: fake(() => textResponse('{"line":"x"}')).client, textModels: ['m'] });
    await expect(long.json<{ line: string }>({ prompt: '', schema, check: () => 'too short' })).rejects.toThrow(/too short/);
  });

  it('drops a model that answers 404 and uses the next one from then on', async () => {
    const { client, calls } = fake((c) => {
      if (c.model === 'retired') throw new ApiError({ message: 'not found', status: 404 });
      return textResponse('ok');
    });
    const g = new Gemini({ client, textModels: ['retired', 'current'] });
    expect(await g.text({ prompt: 'a' })).toBe('ok');
    expect(await g.text({ prompt: 'b' })).toBe('ok');
    expect(calls.map((c) => c.model)).toEqual(['retired', 'current', 'current']);
  });

  it('asks again without the thinking budget when a model must think', async () => {
    const { client, calls } = fake((c) => {
      if (c.config?.thinkingConfig) throw new ApiError({ message: 'thinking budget 0 is not supported', status: 400 });
      return textResponse('ok');
    });
    const g = new Gemini({ client, textModels: ['pro'] });
    expect(await g.text({ prompt: 'a' })).toBe('ok');
    expect(await g.text({ prompt: 'b' })).toBe('ok');
    expect(calls.map((c) => !!c.config?.thinkingConfig)).toEqual([true, false, false]);
  });

  it('turns other API errors and timeouts into AIError without trying more models', async () => {
    const { client, calls } = fake(() => {
      throw new ApiError({ message: 'quota', status: 429 });
    });
    const g = new Gemini({ client, textModels: ['a', 'b'] });
    await expect(g.text({ prompt: '' })).rejects.toThrow(/error 429/);
    expect(calls).toHaveLength(1);
    const slow = new Gemini({
      client: fake(() => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      }).client,
      textModels: ['a'],
    });
    await expect(slow.text({ prompt: '' })).rejects.toThrow(/timed out/);
  });

  it('returns image bytes, asking for the aspect ratio', async () => {
    const png = Buffer.from('fake png');
    const { client, calls } = fake(() => ({
      candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
    }));
    const g = new Gemini({ client, imageModels: ['img'] });
    const out = await g.image({ prompt: 'poster', aspectRatio: '3:4' });
    expect(out).toEqual({ mimeType: 'image/png', data: png, model: 'img' });
    expect(calls[0]!.config).toMatchObject({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:4' } });
    expect(calls[0]!.config?.thinkingConfig).toBeUndefined();
  });

  it('fails soft when the image model sends no image', async () => {
    const g = new Gemini({ client: fake(() => textResponse('sorry')).client, imageModels: ['img'] });
    await expect(g.image({ prompt: 'x' })).rejects.toThrow(/no image/);
  });
});
