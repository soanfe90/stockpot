/**
 * The capture pipeline, client side.
 *
 *   photo -> capture row -> storage -> scan-capture -> draft tray -> commit
 *
 * Nothing here writes stock. Committing the reviewed tray is a single call to
 * commit_capture(), which goes through the same ledger functions the manual
 * path uses.
 */

import { toByteArray } from 'base64-js';
import * as ImageManipulator from 'expo-image-manipulator';

import { errorMessage, supabase } from './supabase';
import type { Capture, CaptureKind, CommitSummary, DraftLine } from './types';

/** Receipts photograph large and compress well; this keeps uploads quick
 *  without losing the small print the scan depends on. */
const MAX_EDGE = 2000;
const QUALITY = 0.75;

export async function prepareImage(uri: string): Promise<{ bytes: Uint8Array; width: number }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  if (!result.base64) throw new Error('Could not read that photo.');
  return { bytes: toByteArray(result.base64), width: result.width };
}

/**
 * Creates the capture row, uploads the photo, and asks the Edge Function to
 * read it. Returns as soon as the scan finishes; the tray is then populated.
 */
export async function scanPhoto(
  householdId: string,
  kind: CaptureKind,
  uri: string,
  model?: string | null
): Promise<Capture> {
  const { data: capture, error: createError } = await supabase
    .from('capture')
    .insert({ household_id: householdId, kind })
    .select()
    .single();
  if (createError) throw createError;

  const path = `${householdId}/${capture.id}.jpg`;

  try {
    const { bytes } = await prepareImage(uri);

    const { error: uploadError } = await supabase.storage
      .from('captures')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    const { error: pathError } = await supabase
      .from('capture')
      .update({ image_path: path })
      .eq('id', capture.id);
    if (pathError) throw pathError;

    const { error: scanError } = await supabase.functions.invoke('scan-capture', {
      body: { capture_id: capture.id, model },
    });
    if (scanError) throw new Error(await readFunctionError(scanError));
  } catch (e) {
    // Leave the row behind with its reason rather than deleting it: the tray
    // screen can then show what went wrong and offer a retry.
    await supabase
      .from('capture')
      .update({ status: 'failed', error: errorMessage(e) })
      .eq('id', capture.id);
    throw e;
  }

  const { data: refreshed } = await supabase.from('capture').select('*').eq('id', capture.id).single();
  return (refreshed ?? capture) as Capture;
}

/** Re-runs the scan on a capture whose photo is already uploaded. */
export async function rescan(captureId: string, model?: string | null): Promise<void> {
  const { error } = await supabase.functions.invoke('scan-capture', {
    body: { capture_id: captureId, model },
  });
  if (error) throw new Error(await readFunctionError(error));
}

export async function loadCapture(captureId: string): Promise<{
  capture: Capture;
  lines: DraftLine[];
}> {
  const [captureRes, lineRes] = await Promise.all([
    supabase.from('capture').select('*').eq('id', captureId).single(),
    supabase.from('draft_line').select('*').eq('capture_id', captureId).order('position'),
  ]);
  if (captureRes.error) throw captureRes.error;
  if (lineRes.error) throw lineRes.error;
  return { capture: captureRes.data as Capture, lines: (lineRes.data ?? []) as DraftLine[] };
}

export async function updateLine(id: string, patch: Partial<DraftLine>): Promise<void> {
  const { error } = await supabase.from('draft_line').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteLine(id: string): Promise<void> {
  const { error } = await supabase.from('draft_line').delete().eq('id', id);
  if (error) throw error;
}

export async function commitCapture(captureId: string): Promise<CommitSummary> {
  const { data, error } = await supabase.rpc('commit_capture', { p_capture_id: captureId });
  if (error) throw error;
  return data as CommitSummary;
}

/** Least-confident rows first: those are the ones worth a human's attention.
 *  Skipped lines sink to the bottom -- they need no decision. */
export function reviewOrder(lines: DraftLine[]): DraftLine[] {
  return [...lines].sort((a, b) => {
    if ((a.resolution === 'skip') !== (b.resolution === 'skip')) {
      return a.resolution === 'skip' ? 1 : -1;
    }
    const confidence = (a.confidence ?? 1) - (b.confidence ?? 1);
    return confidence !== 0 ? confidence : a.position - b.position;
  });
}

export function confidenceLabel(confidence: number | null): 'check' | 'likely' | 'confident' {
  if (confidence === null) return 'likely';
  if (confidence < 0.6) return 'check';
  if (confidence < 0.85) return 'likely';
  return 'confident';
}

/** Edge Function errors arrive as a Response the SDK wraps; dig out the
 *  message the function actually sent so the user sees the real reason. */
async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through to the generic message
    }
  }
  return errorMessage(error);
}
