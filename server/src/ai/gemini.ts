// Gemini for everyone on the server: structured JSON, plain text and images through one client
// (@google/genai). Fail soft (AGENTS.md rule 4): every call has a timeout and throws AIError on any
// failure, so the caller falls back to its template text or template art. A game never waits on it.
//
//   import { gemini, GROUNDED } from './ai/gemini';
//   if (gemini.ready()) {
//     const { line } = await gemini.json<{ line: string }>({
//       system: `You write one news headline.\n${GROUNDED}`,
//       prompt: JSON.stringify(facts),
//       schema: { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] },
//     });
//   }
//   const art = await gemini.image({ prompt: 'A flat two-ink poster of ...', aspectRatio: '1:1' });
//
// Models come from .env (GEMINI_MODEL, GEMINI_IMAGE_MODEL). Google retires model names for new keys,
// so a model that answers 404 is dropped for the rest of the run and the next one in its chain is used.
import { ApiError, GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai';

/** Rules for any prompt that is given facts: the code computes numbers, Gemini only writes words. */
export const GROUNDED = `- Every number you state must appear in the facts you are given: write it exactly as given. Never invent, estimate or calculate new numbers.
- Use only names (places, roads, people) that appear in the facts.
- This is a game played on real city data, not an emergency forecast. Never give real-world emergency instructions.`;

export class AIError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AIError';
  }
}

export interface JsonRequest<T> {
  /** System instruction: the role and the rules. Add GROUNDED when the prompt carries facts. */
  system?: string;
  /** The user turn, usually the facts as JSON. */
  prompt: string;
  /** JSON Schema of the answer (type, properties, required, enum, maxItems ...). */
  schema: Record<string, unknown>;
  /** Extra check after parsing; return an error message to reject the answer. */
  check?: (value: T) => string | null;
  temperature?: number;
  timeoutMs?: number;
}

export interface TextRequest {
  system?: string;
  prompt: string;
  temperature?: number;
  maxChars?: number;
  timeoutMs?: number;
}

export interface ImageRequest {
  prompt: string;
  /** '1:1', '3:4', '4:3', '9:16', '16:9' ... */
  aspectRatio?: string;
  timeoutMs?: number;
}

export interface GeneratedImage {
  mimeType: string;
  data: Buffer;
  model: string;
}

/** The part of the SDK client we use, so tests can pass a fake. */
export interface GenerateClient {
  models: { generateContent(req: { model: string; contents: string; config?: GenerateContentConfig }): Promise<GenerateContentResponse> };
}

export interface GeminiOptions {
  apiKey?: string;
  /** Text models, first choice first. */
  textModels?: string[];
  /** Image models, first choice first. */
  imageModels?: string[];
  client?: GenerateClient;
  timeoutMs?: number;
  imageTimeoutMs?: number;
}

const TEXT_FALLBACKS = ['gemini-3.8-flash', 'gemini-flash-latest'];
const IMAGE_FALLBACKS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];

export class Gemini {
  private readonly key: string;
  private readonly textModels: string[];
  private readonly imageModels: string[];
  private readonly timeoutMs: number;
  private readonly imageTimeoutMs: number;
  private client: GenerateClient | null;
  /** Models that answered 404 (retired or not open to this key). */
  private readonly gone = new Set<string>();
  /** Models that refused thinkingBudget 0 (it keeps flash answers fast where it is allowed). */
  private readonly mustThink = new Set<string>();

  constructor(opts: GeminiOptions = {}) {
    this.key = opts.apiKey ?? process.env.GEMINI_API_KEY?.trim() ?? '';
    this.textModels = opts.textModels ?? uniq([process.env.GEMINI_MODEL, ...TEXT_FALLBACKS]);
    this.imageModels = opts.imageModels ?? uniq([process.env.GEMINI_IMAGE_MODEL, ...IMAGE_FALLBACKS]);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.imageTimeoutMs = opts.imageTimeoutMs ?? 60_000;
    this.client = opts.client ?? null;
  }

  /** True when a key is set. It says nothing about whether Google will answer. */
  ready(): boolean {
    return !!this.key || this.client !== null;
  }

  /** Structured output: the answer is parsed and checked against `schema` and `check`. */
  async json<T>(req: JsonRequest<T>): Promise<T> {
    const { text, model } = await this.generate(this.textModels, req.prompt, {
      systemInstruction: req.system,
      temperature: req.temperature,
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
    }, req.timeoutMs ?? this.timeoutMs);
    let value: T;
    try {
      value = JSON.parse(text) as T;
    } catch (err) {
      throw new AIError(`Gemini (${model}) returned malformed JSON`, err);
    }
    const problem = missingRequired(value, req.schema) ?? req.check?.(value) ?? null;
    if (problem) throw new AIError(`Gemini (${model}) answer rejected: ${problem}`);
    return value;
  }

  /** Plain text, trimmed (and cut at `maxChars`). */
  async text(req: TextRequest): Promise<string> {
    const { text } = await this.generate(this.textModels, req.prompt, {
      systemInstruction: req.system,
      temperature: req.temperature,
    }, req.timeoutMs ?? this.timeoutMs);
    const out = text.trim();
    return req.maxChars ? out.slice(0, req.maxChars) : out;
  }

  /** One generated image (PNG or JPEG bytes). */
  async image(req: ImageRequest): Promise<GeneratedImage> {
    const { response, model } = await this.generate(this.imageModels, req.prompt, {
      responseModalities: ['IMAGE'],
      ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
    }, req.timeoutMs ?? this.imageTimeoutMs, false);
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new AIError(`Gemini (${model}) returned no image`);
    return { mimeType: inline.mimeType ?? 'image/png', data: Buffer.from(inline.data, 'base64'), model };
  }

  private sdk(): GenerateClient {
    if (!this.ready()) throw new AIError('Gemini is not configured (GEMINI_API_KEY is missing)');
    this.client ??= new GoogleGenAI({ apiKey: this.key });
    return this.client;
  }

  /** Tries each model in the chain that is not gone; a 404 moves on, any other failure throws. */
  private async generate(chain: string[], contents: string, config: GenerateContentConfig, timeoutMs: number, text = true) {
    const client = this.sdk();
    const models = chain.filter((m) => !this.gone.has(m));
    if (models.length === 0) throw new AIError(`No Gemini model left to try (${chain.join(', ')} unavailable)`);
    let last: unknown;
    for (const model of models) {
      const thinkOff = text && !this.mustThink.has(model);
      try {
        const response = await this.call(client, model, contents, {
          ...config,
          ...(thinkOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        }, timeoutMs);
        const out = text ? response.text : '';
        if (text && !out) throw new AIError(`Gemini (${model}) returned no text (${response.candidates?.[0]?.finishReason ?? 'no candidate'})`);
        return { response, text: out ?? '', model };
      } catch (err) {
        last = err;
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 404) {
          this.gone.add(model);
          continue;
        }
        if (status === 400 && thinkOff && /thinking/i.test(String((err as Error).message))) {
          // This model must think: ask again without the budget, and remember.
          this.mustThink.add(model);
          try {
            const response = await this.call(client, model, contents, config, timeoutMs);
            if (text && !response.text) throw new AIError(`Gemini (${model}) returned no text`);
            return { response, text: response.text ?? '', model };
          } catch (retry) {
            throw asAIError(retry, model);
          }
        }
        throw asAIError(err, model);
      }
    }
    throw asAIError(last, models.at(-1) ?? '?');
  }

  private async call(client: GenerateClient, model: string, contents: string, config: GenerateContentConfig, timeoutMs: number) {
    return client.models.generateContent({
      model,
      contents,
      // Client-side only: Google refuses a server deadline (httpOptions.timeout) under 10 s.
      config: { ...config, abortSignal: AbortSignal.timeout(timeoutMs) },
    });
  }
}

function asAIError(err: unknown, model: string): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof ApiError) return new AIError(`Gemini (${model}) error ${err.status}: ${err.message.slice(0, 200)}`, err);
  const name = (err as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new AIError(`Gemini (${model}) timed out`, err);
  return new AIError(`Gemini (${model}) is unreachable (${name ?? typeof err})`, err);
}

/** The top-level `required` keys of an object schema that the answer lacks. */
function missingRequired(value: unknown, schema: Record<string, unknown>): string | null {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  if (required.length === 0) return null;
  if (typeof value !== 'object' || value === null) return 'not an object';
  const missing = required.filter((k) => (value as Record<string, unknown>)[k] === undefined);
  return missing.length ? `missing ${missing.join(', ')}` : null;
}

/** The shared client, configured from .env. */
export const gemini = new Gemini();
