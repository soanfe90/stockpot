/**
 * scan-capture
 *
 * Reads a photographed receipt or a photo of groceries and writes an editable
 * draft tray. It never touches inventory: the user reviews the tray and
 * commit_capture() does the writing.
 *
 * Runs server-side because ANTHROPIC_API_KEY must not ship in the app bundle.
 *
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy scan-capture
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.124.0/helpers/zod';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@^1/base64';
import { z } from 'npm:zod@4.6.1';

import { corsHeaders, fail, json } from '../_shared/cors.ts';

/* ------------------------------------------------------------------ types -- */

// Display units the model may choose from. Kept in step with DISPLAY_UNITS in
// src/lib/units.ts and to_base_qty() in the capture migration.
const UNITS = ['g', 'kg', 'ml', 'L', 'ud'] as const;

const CATEGORIES = [
  'Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery', 'Grains & Pasta',
  'Canned & Jarred', 'Frozen', 'Condiments & Spices', 'Snacks', 'Drinks', 'Other',
] as const;

const LineSchema = z.object({
  raw_text: z.string().describe('The line exactly as printed, or "" for a product photo'),
  name: z.string().describe('A clean, human-readable product name'),
  quantity: z.number().describe('Amount in the chosen unit; 1 when only a count is knowable'),
  unit: z.enum(UNITS),
  category: z.enum(CATEGORIES),
  unit_price: z.number().nullable(),
  matched_product_id: z.string().nullable().describe('An id from the catalog, or null'),
  confidence: z.number().describe('0 to 1, honest'),
  resolution: z.enum(['merge', 'new', 'skip']),
  skip_reason: z.string().nullable(),
});

const ScanSchema = z.object({
  store: z.string().nullable(),
  purchased_on: z.string().nullable().describe('YYYY-MM-DD if printed, else null'),
  lines: z.array(LineSchema),
});

const BASE_UNIT: Record<(typeof UNITS)[number], 'g' | 'ml' | 'unit'> = {
  g: 'g', kg: 'g', ml: 'ml', L: 'ml', ud: 'unit',
};

/* ----------------------------------------------------------------- prompt -- */

const SYSTEM_RULES = `You read grocery receipts and photos of groceries for a
pantry-tracking app, and turn them into a list of products the user will review
before anything is saved.

Rules that always apply:

- Report only what is actually visible. Never infer a product that is not there,
  and never pad a short receipt.
- Quantity: use the printed weight or volume when there is one (g, kg, ml, L).
  Otherwise count items and use "ud". A receipt line reading "2 x 1,5 L" is
  quantity 3 with unit L.
- Receipts print decimals with a comma in much of the world. "0,842" is 0.842.
- Receipts and packaging may be in any language. Keep the product name in the
  language it is written in; do not translate it.

For receipts specifically:

- One entry per purchasable item.
- Set resolution "skip" for anything that is not food or household stock:
  bags, deposits and returns, discounts and coupons, loyalty lines, subtotals,
  taxes, totals, change, and payment lines. Give a short skip_reason.
- raw_text must be the line exactly as printed, abbreviations and all. This is
  what the app remembers, so the same line resolves without a scan next time.

For photos of groceries:

- One entry per distinct product visible. Set raw_text to "".
- Read the weight or volume off the packaging when legible; otherwise count.

Matching against the household's catalog:

- If an item is clearly one of the catalog products, set resolution "merge" and
  matched_product_id to that product's id. An alias listed for a product is a
  direct hit: treat it as certain.
- Otherwise set resolution "new" and matched_product_id null.
- confidence must be honest. A blurred or ambiguous line belongs near 0.3, not
  0.9; the app sorts low-confidence rows to the top for the user to check, and
  an overconfident wrong row is worse than an uncertain one.`;

/* ------------------------------------------------------------------- main -- */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('Missing Authorization header.', 401);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return fail('ANTHROPIC_API_KEY is not set on this project. Run: supabase secrets set ANTHROPIC_API_KEY=...', 500);
  }

  let captureId: string;
  try {
    ({ capture_id: captureId } = await req.json());
  } catch {
    return fail('Send a JSON body with a capture_id.');
  }
  if (!captureId) return fail('capture_id is required.');

  // The caller's own token, so every read and write below is subject to the
  // same row-level security as the app itself. No service role key here.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: capture, error: captureError } = await supabase
    .from('capture').select('*').eq('id', captureId).single();

  if (captureError || !capture) return fail('That scan does not exist, or is not yours.', 404);
  if (capture.status === 'committed') return fail('That scan was already added to the inventory.', 409);
  if (!capture.image_path) return fail('That scan has no image attached.');

  await supabase.from('capture').update({ status: 'scanning' }).eq('id', captureId);

  try {
    const { data: blob, error: downloadError } = await supabase
      .storage.from('captures').download(capture.image_path);
    if (downloadError || !blob) throw new Error('Could not read the photo from storage.');

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';

    // Catalog and learned aliases go into the prompt so the model can resolve
    // a till abbreviation to a product directly.
    const [{ data: products }, { data: aliases }] = await Promise.all([
      supabase.from('product')
        .select('id, name, category, base_unit, display_unit')
        .eq('household_id', capture.household_id),
      supabase.from('product_alias')
        .select('product_id, raw_text')
        .eq('household_id', capture.household_id),
    ]);

    const aliasesByProduct = new Map<string, string[]>();
    for (const a of aliases ?? []) {
      const list = aliasesByProduct.get(a.product_id) ?? [];
      list.push(a.raw_text);
      aliasesByProduct.set(a.product_id, list);
    }

    const catalog = (products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      unit: p.display_unit,
      aliases: aliasesByProduct.get(p.id) ?? [],
    }));

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const response = await anthropic.beta.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // A refusal on a grocery photo would be spurious; let the API rescue the
      // call rather than failing a scan the user is standing in a kitchen for.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'high',
        format: zodOutputFormat(ScanSchema),
      },
      system: [
        { type: 'text', text: SYSTEM_RULES },
        {
          type: 'text',
          text: `The household's current catalog, as JSON:\n${JSON.stringify(catalog)}`,
          // Stable prefix ends here: rules and catalog change rarely, the photo
          // changes every call. Regenerating a scan then reads a warm cache.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: encodeBase64(bytes) } },
            {
              type: 'text',
              text: capture.kind === 'receipt'
                ? 'This is a supermarket receipt. List everything purchasable on it.'
                : 'This is a photo of groceries. List every distinct product you can see.',
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined to read this image. Try a clearer photo of just the receipt.');
    }

    const parsed = response.parsed_output;
    if (!parsed) throw new Error('The scan came back in an unreadable shape. Try again.');

    const rows = parsed.lines.map((line, index) => ({
      capture_id: captureId,
      household_id: capture.household_id,
      raw_text: line.raw_text || null,
      name: line.name,
      qty: line.quantity,
      display_unit: line.unit,
      base_unit: BASE_UNIT[line.unit],
      category: line.category,
      unit_price: line.unit_price,
      matched_product_id: line.resolution === 'merge' ? line.matched_product_id : null,
      confidence: Math.min(1, Math.max(0, line.confidence)),
      resolution: line.resolution,
      skip_reason: line.skip_reason,
      position: index,
    }));

    // Replace rather than append, so re-scanning a capture is idempotent.
    await supabase.from('draft_line').delete().eq('capture_id', captureId);
    if (rows.length) {
      const { error: insertError } = await supabase.from('draft_line').insert(rows);
      if (insertError) throw insertError;
    }

    await supabase.from('capture').update({
      status: 'ready',
      store: parsed.store,
      purchased_on: isIsoDate(parsed.purchased_on) ? parsed.purchased_on : null,
      model_response: parsed,
      error: null,
    }).eq('id', captureId);

    return json({
      capture_id: captureId,
      store: parsed.store,
      purchased_on: parsed.purchased_on,
      lines: rows.length,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from('capture').update({ status: 'failed', error: message }).eq('id', captureId);
    return fail(message, 502);
  }
});

function isIsoDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
