import { useRouter } from 'expo-router';

import { backOr } from '@/lib/navigation';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, ErrorNote, Eyebrow, Field, Segmented } from '@/components/ui/kit';
import { CATEGORIES, NATURAL_STORAGE, shelfLife, type Category } from '@/lib/categories';
import { daysUntil, formatDate, isoDateIn } from '@/lib/expiry';
import { errorMessage, supabase } from '@/lib/supabase';
import { STORAGE_PLACES, type StoragePlace } from '@/lib/types';
import { BASE_UNIT_LABELS, DISPLAY_UNITS, parseQty, toBase, type BaseUnit } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function NewProductScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('Produce');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>('g');
  const [unitKey, setUnitKey] = useState('g');
  const [quantity, setQuantity] = useState('');
  const [usefulLife, setUsefulLife] = useState(String(shelfLife('Produce', 'fridge')));
  const [expiry, setExpiry] = useState(isoDateIn(shelfLife('Produce', 'fridge')));
  const [storage, setStorage] = useState<StoragePlace>(NATURAL_STORAGE.Produce);
  const [lowThreshold, setLowThreshold] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Useful life and expiry are two views of one fact: set either and the
   *  other follows, so nobody types a date twice. */
  function applyUsefulLife(value: string) {
    setUsefulLife(value);
    const days = Number.parseInt(value, 10);
    if (Number.isFinite(days) && days >= 0) setExpiry(isoDateIn(days));
  }

  function applyExpiry(value: string) {
    setExpiry(value);
    const days = daysUntil(value);
    if (days !== null && days >= 0) setUsefulLife(String(days));
  }

  /**
   * Category and storage together decide how long something keeps -- peas in
   * the freezer are not peas in the fridge -- so changing either re-reads the
   * shelf life. Both only ever move the *suggestion*: a date typed by hand
   * survives, because applyExpiry is what writes the life in that direction.
   */
  function applyCategory(next: Category) {
    const place = NATURAL_STORAGE[next];
    setCategory(next);
    setStorage(place);
    applyUsefulLife(String(shelfLife(next, place)));
  }

  function applyStorage(next: StoragePlace) {
    setStorage(next);
    applyUsefulLife(String(shelfLife(category, next)));
  }

  function applyBaseUnit(next: BaseUnit) {
    setBaseUnit(next);
    setUnitKey(DISPLAY_UNITS[next][0].key);
  }

  async function save() {
    setError(null);

    if (!household) {
      setError('No household loaded. Pull to refresh and try again.');
      return;
    }
    if (!name.trim()) {
      setError('Give the product a name.');
      return;
    }

    const qty = quantity.trim() ? parseQty(quantity) : 0;
    if (qty === null) {
      setError('That quantity is not a number. Use digits, with a dot or comma for decimals.');
      return;
    }

    const life = Number.parseInt(usefulLife, 10);
    if (!Number.isFinite(life) || life < 0) {
      setError('Useful life must be a whole number of days.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      setError('Write the expiry date as YYYY-MM-DD.');
      return;
    }

    const low = lowThreshold.trim() ? parseQty(lowThreshold) : 0;
    if (low === null) {
      setError('The low-stock amount is not a number.');
      return;
    }

    setBusy(true);
    try {
      const { data: product, error: insertError } = await supabase
        .from('product')
        .insert({
          household_id: household.id,
          name: name.trim(),
          category,
          base_unit: baseUnit,
          display_unit: unitKey,
          default_useful_life_days: life,
          low_threshold: low ? toBase(low, baseUnit, unitKey) : 0,
          storage,
          notes: notes.trim() || null })
        .select()
        .single();

      if (insertError) {
        // 23505 is the unique index on (household_id, lower(name)).
        throw insertError.code === '23505'
          ? new Error(`You already track a product called "${name.trim()}". Open it to add more stock.`)
          : insertError;
      }

      if (qty > 0) {
        const { error: stockError } = await supabase.rpc('add_stock', {
          p_product_id: product.id,
          p_qty: toBase(qty, baseUnit, unitKey),
          p_expires_on: expiry,
          p_storage: storage });
        if (stockError) throw stockError;
      }

      backOr(router, '/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled">
        <Field label="Product name" value={name} onChangeText={setName} placeholder="Leche entera" autoCapitalize="sentences" />

        <Segmented
          label="Category"
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          value={category}
          onChange={applyCategory}
        />

        <View style={{ gap: space.lg }}>
          <Segmented
            label="Measured by"
            options={(Object.keys(BASE_UNIT_LABELS) as BaseUnit[]).map((u) => ({ value: u, label: BASE_UNIT_LABELS[u] }))}
            value={baseUnit}
            onChange={applyBaseUnit}
          />
          <Segmented
            label="Shown as"
            options={DISPLAY_UNITS[baseUnit].map((u) => ({ value: u.key, label: `${u.key} — ${u.label}` }))}
            value={unitKey}
            onChange={setUnitKey}
          />
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            Stockpot stores everything in {baseUnit === 'unit' ? 'whole units' : baseUnit} and converts for display, so
            recipes and receipts stay comparable.
          </Text>
        </View>

        <Field
          label="Quantity on hand"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          suffix={unitKey}
          placeholder="0"
          hint="Leave blank to add the product to the catalog without any stock."
        />

        <Card>
          <View style={{ gap: space.lg }}>
            <Eyebrow>Freshness</Eyebrow>
            <Field
              label="Useful life"
              value={usefulLife}
              onChangeText={applyUsefulLife}
              keyboardType="number-pad"
              suffix="days"
              hint={`Suggested for ${category.toLowerCase()} kept in the ${storage}. Stock you put somewhere else is dated from this.`}
            />
            <Field
              label="Expires on"
              value={expiry}
              onChangeText={applyExpiry}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="YYYY-MM-DD"
              hint={`Reads as ${formatDate(expiry)}. Changing either field updates the other.`}
            />
          </View>
        </Card>

        <Field
          label="Tell me when it drops below"
          value={lowThreshold}
          onChangeText={setLowThreshold}
          keyboardType="decimal-pad"
          suffix={unitKey}
          placeholder="0"
          hint="Optional. Below this, the product joins your shopping list as running low. Leave blank to be told only when it runs out."
        />

        <Segmented
          label="Stored in"
          options={STORAGE_PLACES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          value={storage}
          onChange={applyStorage}
        />

        <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Brand, size, where it lives" multiline />

        <ErrorNote message={error} />

        <View style={{ gap: space.sm }}>
          <Button label="Add to inventory" onPress={save} busy={busy} />
          <Button label="Cancel" variant="ghost" onPress={() => backOr(router, '/')} />
        </View>

        <Body>
          Photographing receipts and groceries replaces most of this form in phase 2. The fields stay the same — the
          camera just fills them in.
        </Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
