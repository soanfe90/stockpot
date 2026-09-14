/**
 * One way to ask a model for structured JSON, whichever provider is behind it.
 *
 * Both providers do the same job here: take a system prompt, some text and
 * maybe an image, and return JSON matching a schema. Keeping that behind one
 * function means switching providers is an environment variable, not a
 * rewrite -- and it means you can run the same receipt through both and
 * compare, which is the only way to actually know which reads yours better.
 *
 * Whatever comes back is validated against the zod schema before it is
 * returned. Structured output is a strong hint, not a guarantee, and the rest
 * of the app is entitled to assume the shape it was promised.
 *
 *   LLM_PROVIDER    gemini (default) | anthropic
 *   GEMINI_API_KEY  + GEMINI_MODEL
 *   ANTHROPIC_API_KEY + ANTHROPIC_MODEL
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.124.0/helpers/zod';
import { GoogleGenAI } from 'npm:@google/genai@2.22.0';
import { z } from 'npm:zod@4.6.1';

/** The image types every provider here accepts. The app uploads JPEG, so this
 *  is a ceiling rather than a constraint in practice. */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type LlmPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: ImageMimeType; data: string };

/** Narrows whatever storage reports to something a provider will accept. */
export function asImageMimeType(value: string | null | undefined): ImageMimeType {
  switch (value) {
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
      return value;
    default:
      return 'image/jpeg';
  }
}

export type Provider = 'gemini' | 'anthropic';

/**
 * Gemini models a household may choose between, cheapest first.
 *
 * An allowlist rather than a free string: the model name arrives from the app,
 * and it decides what each call costs against the household's own API key. A
 * typo should fall back to the default, not bill them for something exotic or
 * fail every request until somebody notices.
 *
 * GEMINI_MODEL still sets the default, so an operator can pin a different one
 * without a release.
 */
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

export function asGeminiModel(value: unknown): GeminiModel | null {
  return typeof value === 'string' && (GEMINI_MODELS as readonly string[]).includes(value)
    ? (value as GeminiModel)
    : null;
}

export function activeProvider(): Provider {
  return (Deno.env.get('LLM_PROVIDER') ?? 'gemini').toLowerCase() === 'anthropic'
    ? 'anthropic'
    : 'gemini';
}

/** Raised with a message meant for the person holding the phone. */
export class LlmError extends Error {}

export async function generateStructured<T>(opts: {
  system: string;
  parts: LlmPart[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  /** Prepended to error messages so a failure names which call broke. */
  label: string;
  /** Overrides the default for this one call. Ignored by providers other than
   *  the one it names, and by an unrecognised value. */
  model?: string | null;
}): Promise<T> {
  const raw =
    activeProvider() === 'anthropic' ? await viaAnthropic(opts) : await viaGemini(opts);

  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    throw new LlmError(
      `${opts.label}: the model returned a shape the app cannot use. ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ')}`
    );
  }
  return parsed.data;
}

/* ----------------------------------------------------------------- gemini -- */

async function viaGemini<T>(opts: {
  system: string;
  parts: LlmPart[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  label: string;
  model?: string | null;
}): Promise<unknown> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new LlmError('GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=...');
  }
  const model = asGeminiModel(opts.model) ?? Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';

  // responseJsonSchema takes standard JSON Schema; responseSchema is the
  // narrower OpenAPI subset that rejects additionalProperties, so this is the
  // field that can consume a zod schema as-is.
  const jsonSchema = toJsonSchema(opts.schema);

  const ai = new GoogleGenAI({ apiKey });

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: opts.parts.map((part) =>
            part.type === 'text'
              ? { text: part.text }
              : { inlineData: { mimeType: part.mimeType, data: part.data } }
          ),
        },
      ],
      config: {
        systemInstruction: opts.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        maxOutputTokens: opts.maxOutputTokens ?? 16000,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The most likely first-run failure is a model name this key cannot use,
    // so say which name was tried and which variable changes it.
    if (/not found|NOT_FOUND|404|unsupported|not supported/i.test(message)) {
      throw new LlmError(
        `${opts.label}: Gemini rejected the model "${model}". Set GEMINI_MODEL to a model your API key can use — ` +
          `list them with: curl -H "x-goog-api-key: $GEMINI_API_KEY" https://generativelanguage.googleapis.com/v1beta/models`
      );
    }
    throw new LlmError(`${opts.label}: ${message}`);
  }

  const text = response.text;
  if (!text) {
    throw new LlmError(
      `${opts.label}: Gemini returned nothing. This usually means the response hit maxOutputTokens or was filtered.`
    );
  }
  return parseJson(text, opts.label);
}

/* -------------------------------------------------------------- anthropic -- */

async function viaAnthropic<T>(opts: {
  system: string;
  parts: LlmPart[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  label: string;
}): Promise<unknown> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new LlmError('ANTHROPIC_API_KEY is not set. Run: supabase secrets set ANTHROPIC_API_KEY=...');
  }
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5';
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.beta.messages.parse({
    model,
    max_tokens: opts.maxOutputTokens ?? 16000,
    thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: zodOutputFormat(opts.schema as never) },
    system: [
      { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: opts.parts.map((part) =>
          part.type === 'text'
            ? ({ type: 'text', text: part.text } as const)
            : ({
                type: 'image',
                source: { type: 'base64', media_type: part.mimeType, data: part.data },
              } as const)
        ),
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new LlmError(`${opts.label}: the model declined this request.`);
  }
  return response.parsed_output;
}

/* ----------------------------------------------------------------- helpers -- */

function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  // $schema is metadata about the document, not part of the contract Gemini
  // needs, and some versions reject unknown top-level keys.
  delete generated.$schema;
  return generated;
}

function parseJson(text: string, label: string): unknown {
  // Asking for application/json usually returns bare JSON, but a fenced block
  // slips through often enough that stripping one is cheaper than a failure.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LlmError(`${label}: the model's reply was not valid JSON.`);
  }
}
