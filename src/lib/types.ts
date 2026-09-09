/**
 * Row shapes, hand-written to match supabase/migrations.
 *
 * Once a Supabase project exists, replace this file with the generated
 * version and keep the derived types at the bottom:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/types.ts
 */

import type { BaseUnit } from './units';

export type MemberRole = 'owner' | 'member';
export type StoragePlace = 'fridge' | 'freezer' | 'pantry';
export type MovementReason = 'purchase' | 'cook' | 'waste' | 'correction';

export const STORAGE_PLACES: StoragePlace[] = ['fridge', 'freezer', 'pantry'];

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  size: number;
  created_at: string;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
};

export type Product = {
  id: string;
  household_id: string;
  name: string;
  category: string;
  base_unit: BaseUnit;
  display_unit: string;
  grams_per_unit: number | null;
  default_useful_life_days: number;
  low_threshold: number;
  storage: StoragePlace;
  image_url: string | null;
  barcode: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryLot = {
  id: string;
  household_id: string;
  product_id: string;
  qty: number;
  reserved_qty: number;
  purchased_on: string;
  expires_on: string | null;
  opened_at: string | null;
  storage: StoragePlace;
  unit_price: number | null;
  created_at: string;
};

export type ProductStock = {
  product_id: string;
  household_id: string;
  qty_total: number;
  qty_reserved: number;
  next_expiry: string | null;
  lot_count: number;
};

/** A product joined to its rolled-up stock -- what the inventory list renders. */
export type StockedProduct = Product & {
  qty_total: number;
  qty_reserved: number;
  next_expiry: string | null;
  lot_count: number;
};

/* ------------------------------------------------------------- capture --- */

export type CaptureKind = 'receipt' | 'products';
export type CaptureStatus = 'uploaded' | 'scanning' | 'ready' | 'committed' | 'failed';
export type LineResolution = 'merge' | 'new' | 'skip';

export type Capture = {
  id: string;
  household_id: string;
  kind: CaptureKind;
  image_path: string | null;
  status: CaptureStatus;
  store: string | null;
  purchased_on: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  committed_at: string | null;
};

/** One editable row in the draft tray. Nothing here has touched inventory. */
export type DraftLine = {
  id: string;
  capture_id: string;
  household_id: string;
  raw_text: string | null;
  name: string;
  qty: number;
  display_unit: string;
  base_unit: BaseUnit;
  category: string;
  unit_price: number | null;
  expires_on: string | null;
  storage: StoragePlace | null;
  matched_product_id: string | null;
  confidence: number | null;
  resolution: LineResolution;
  skip_reason: string | null;
  position: number;
  created_at: string;
};

export type CommitSummary = {
  products_created: number;
  lines_committed: number;
  lines_skipped: number;
  aliases_learned: number;
};
