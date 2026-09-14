import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatePill } from '@/components/inventory/product-row';
import { Button, Card, ErrorNote, Eyebrow, Field, Loading, Segmented } from '@/components/ui/kit';
import { usefulLifeFor } from '@/lib/categories';
import { formatDate, isoDateIn, stockState } from '@/lib/expiry';
import { errorMessage, supabase } from '@/lib/supabase';
import { STORAGE_PLACES, type InventoryLot, type Product, type StoragePlace } from '@/lib/types';
import { formatQty, fromBase, parseQty, toBase } from '@/lib/units';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ProductScreen() {
  const t = useTokens();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [product, setProduct] = useState<Product | null>(null);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lowThreshold, setLowThreshold] = useState('');
  const [usefulLife, setUsefulLife] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addExpiry, setAddExpiry] = useState('');
  const [addStorage, setAddStorage] = useState<StoragePlace>('pantry');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [productRes, lotRes] = await Promise.all([
        supabase.from('product').select('*').eq('id', id).single(),
        supabase
          .from('inventory_lot')
          .select('*')
          .eq('product_id', id)
          .order('expires_on', { ascending: true, nullsFirst: false }),
      ]);
      if (productRes.error) throw productRes.error;
      if (lotRes.error) throw lotRes.error;

      const loaded = productRes.data as Product;
      setProduct(loaded);
      setLots((lotRes.data ?? []) as InventoryLot[]);
      setAddStorage(loaded.storage);
      setAddExpiry(isoDateIn(loaded.default_useful_life_days));
      setUsefulLife(String(loaded.default_useful_life_days));
      setLowThreshold(
        loaded.low_threshold > 0
          ? String(fromBase(loaded.low_threshold, loaded.base_unit, loaded.display_unit))
          : ''
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    if (product) navigation.setOptions({ title: product.name });
  }, [navigation, product]);

  async function addStock() {
    if (!product) return;
    const qty = parseQty(addQty);
    if (qty === null || qty <= 0) {
      setError('Enter how much you are adding.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(addExpiry)) {
      setError('Write the expiry date as YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('add_stock', {
        p_product_id: product.id,
        p_qty: toBase(qty, product.base_unit, product.display_unit),
        p_expires_on: addExpiry,
        p_storage: addStorage });
      if (rpcError) throw rpcError;
      setAddQty('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Corrections send the target, never a computed delta: the server works
   *  out the difference under a row lock so two members cannot collide. */
  async function correctLot(lot: InventoryLot, targetDisplay: string) {
    if (!product) return;
    const value = parseQty(targetDisplay);
    if (value === null) {
      setError('That is not a number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('set_lot_quantity', {
        p_lot_id: lot.id,
        p_target: toBase(value, product.base_unit, product.display_unit) });
      if (rpcError) throw rpcError;
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Below this, the shopping list picks the product up as running low. Zero
   *  turns that off, leaving only the out-of-stock trigger. */
  async function saveLowThreshold() {
    if (!product) return;
    const value = lowThreshold.trim() ? parseQty(lowThreshold) : 0;
    if (value === null) {
      setError('That is not a number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('product')
        .update({ low_threshold: value ? toBase(value, product.base_unit, product.display_unit) : 0 })
        .eq('id', product.id);
      if (updateError) throw updateError;
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Where a product lives and how long it keeps are plain attributes, not
   * quantities, so they are written straight to the row -- the ledger rule is
   * about stock amounts, and neither of these moves a gram.
   */
  async function updateProduct(patch: Partial<Product>) {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from('product').update(patch).eq('id', product.id);
      if (updateError) throw updateError;
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Moving a lot to another shelf. Its quantity, its expiry and its place in
   *  the oldest-first queue are all untouched. */
  async function updateLot(lot: InventoryLot, patch: Partial<InventoryLot>) {
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from('inventory_lot').update(patch).eq('id', lot.id);
      if (updateError) throw updateError;
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The shelf decides how long it keeps, so choosing one re-dates the
   * suggestion. Only the suggestion: a date already typed by hand is left
   * alone, since the whole point of typing it was that the packet knows better.
   */
  function applyAddStorage(next: StoragePlace) {
    if (!product) return;
    setAddStorage(next);
    if (addExpiry === isoDateIn(usefulLifeFor(product.category, product.default_useful_life_days, product.storage, addStorage))) {
      setAddExpiry(isoDateIn(usefulLifeFor(product.category, product.default_useful_life_days, product.storage, next)));
    }
  }

  function saveUsefulLife() {
    const days = Number.parseInt(usefulLife, 10);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      setError('Give a useful life between 0 and 3650 days.');
      return;
    }
    void updateProduct({ default_useful_life_days: days });
  }

  function confirmDelete() {
    if (!product) return;
    Alert.alert(
      `Delete ${product.name}?`,
      'Its lots and movement history go with it. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error: deleteError } = await supabase.from('product').delete().eq('id', product.id);
            if (deleteError) setError(errorMessage(deleteError));
            else router.back();
          } },
      ]
    );
  }

  if (loading) return <Loading />;
  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg }}>
        <ErrorNote message={error ?? 'That product no longer exists.'} />
      </View>
    );
  }

  // Two lives: what this product keeps on its usual shelf, and what it would
  // keep on the one this lot is going to.
  const usualLife = product.default_useful_life_days;
  const lotLife = usefulLifeFor(product.category, usualLife, product.storage, addStorage);
  const expiryReason =
    addStorage === product.storage
      ? `Pre-filled from this product's useful life.`
      : lotLife > usualLife
        ? `Longer than its usual ${usualLife} days, because this lot is going in the ${addStorage}.`
        : `Shorter than its usual ${usualLife} days, because this lot is going in the ${addStorage}.`;

  const total = lots.reduce((sum, lot) => sum + Number(lot.qty), 0);
  const nextExpiry = lots.find((lot) => Number(lot.qty) > 0)?.expires_on ?? null;
  const state = stockState(total, nextExpiry);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text style={{ fontSize: 28, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink, fontVariant: ['tabular-nums'] }}>
              {formatQty(total, product.base_unit, product.display_unit)}
            </Text>
            <StatePill state={state} expiry={nextExpiry} />
          </View>
          <Text style={{ fontSize: 13, color: t.inkFaint }}>
            {product.category} · usually the {product.storage} · {product.default_useful_life_days} days there
          </Text>
        </View>

        <ErrorNote message={error} />

        <View style={{ gap: space.md }}>
          <Eyebrow>Lots{lots.length > 1 ? ` · ${lots.length}` : ''}</Eyebrow>
          {lots.length === 0 ? (
            <Card>
              <Text style={{ color: t.inkMuted, fontSize: 14, lineHeight: 20 }}>
                No stock on record. Add some below and the expiry clock starts.
              </Text>
            </Card>
          ) : (
            <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
              {lots.map((lot, index) => (
                <LotRow
                  key={lot.id}
                  lot={lot}
                  product={product}
                  first={index === 0}
                  busy={busy}
                  onCorrect={(value) => void correctLot(lot, value)}
                  onMove={(storage) => void updateLot(lot, { storage })}
                />
              ))}
            </View>
          )}
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            Lots are kept apart on purpose: cooking always drains the one closest to expiring.
          </Text>
        </View>

        <Card>
          <View style={{ gap: space.lg }}>
            <Eyebrow>Add stock</Eyebrow>
            <Field
              label="Quantity"
              value={addQty}
              onChangeText={setAddQty}
              keyboardType="decimal-pad"
              suffix={product.display_unit}
              placeholder="0"
            />
            <Field
              label="Expires on"
              value={addExpiry}
              onChangeText={setAddExpiry}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="YYYY-MM-DD"
              hint={`Reads as ${formatDate(addExpiry)}. ${expiryReason}`}
            />
            <Segmented
              label="Stored in"
              options={STORAGE_PLACES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
              value={addStorage}
              onChange={applyAddStorage}
            />
            <Button label="Add stock" onPress={addStock} busy={busy} />
          </View>
        </Card>

        <Card>
          <View style={{ gap: space.lg }}>
            <Eyebrow>Where it lives, and how long it keeps</Eyebrow>
            {/* This is the product's default, applied to stock added from now
                on. Lots already on the shelf keep the dates they were given --
                changing this does not rewrite history. */}
            <Segmented
              label="Usually stored in"
              options={STORAGE_PLACES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
              value={product.storage}
              onChange={(storage) => void updateProduct({ storage })}
            />
            <Field
              label="Useful life"
              value={usefulLife}
              onChangeText={setUsefulLife}
              keyboardType="number-pad"
              suffix="days"
              hint={`How long it keeps in the ${product.storage}. Stock put somewhere else is dated from this — ${
                product.storage === 'freezer' ? 'the fridge' : 'the freezer'
              } gives it ${usefulLifeFor(
                product.category,
                usualLife,
                product.storage,
                product.storage === 'freezer' ? 'fridge' : 'freezer'
              )} days. Existing lots keep the dates they were given.`}
            />
            <Button label="Save useful life" variant="secondary" onPress={saveUsefulLife} busy={busy} />
          </View>
        </Card>

        <Card>
          <View style={{ gap: space.lg }}>
            <Eyebrow>Running low</Eyebrow>
            <Field
              label="Tell me when it drops below"
              value={lowThreshold}
              onChangeText={setLowThreshold}
              keyboardType="decimal-pad"
              suffix={product.display_unit}
              placeholder="0"
              hint="Leave blank to be told only when it runs out entirely."
            />
            <Button label="Save" variant="secondary" onPress={saveLowThreshold} busy={busy} />
          </View>
        </Card>

        <Button label="Delete product" variant="danger" onPress={confirmDelete} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LotRow({
  lot,
  product,
  first,
  busy,
  onCorrect,
  onMove }: {
  lot: InventoryLot;
  product: Product;
  first: boolean;
  busy: boolean;
  onCorrect: (value: string) => void;
  onMove: (storage: StoragePlace) => void;
}) {
  const t = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const state = stockState(Number(lot.qty), lot.expires_on);

  return (
    <View
      style={{
        padding: space.lg,
        gap: space.md,
        backgroundColor: t.surface,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ gap: 3, flex: 1 }}>
          <Text style={{ fontSize: 15, fontFamily: fonts.semibold, color: t.ink, fontVariant: ['tabular-nums'] }}>
            {formatQty(Number(lot.qty), product.base_unit, product.display_unit)}
          </Text>
          <Text style={{ fontSize: 12, color: t.inkFaint }}>
            {formatDate(lot.expires_on)} · {lot.storage}
            {Number(lot.reserved_qty) > 0
              ? ` · ${formatQty(Number(lot.reserved_qty), product.base_unit, product.display_unit)} reserved`
              : ''}
          </Text>
        </View>
        <StatePill state={state} expiry={lot.expires_on} />
      </View>

      {editing ? (
        <View style={{ gap: space.lg }}>
          <Field
            label="Correct to"
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            suffix={product.display_unit}
            autoFocus
          />
          {/* Saved on tap rather than with the quantity: moving a bag to the
              freezer is its own decision, and usually the only one being made. */}
          <Segmented
            label="Stored in"
            options={STORAGE_PLACES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            value={lot.storage}
            onChange={onMove}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Save"
              onPress={() => {
                onCorrect(draft);
                setEditing(false);
              }}
              busy={busy}
              style={{ flex: 1 }}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDraft(String(fromBase(Number(lot.qty), product.base_unit, product.display_unit)));
            setEditing(true);
          }}>
          <Text style={{ color: t.accentText, fontSize: 13, fontFamily: fonts.semibold }}>
            Correct quantity or move it
          </Text>
        </Pressable>
      )}
    </View>
  );
}
