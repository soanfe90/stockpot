import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/text';

import { Button, Eyebrow, Field, Segmented } from '@/components/ui/kit';
import { CATEGORIES } from '@/lib/categories';
import { confidenceLabel } from '@/lib/capture';
import type { DraftLine, LineResolution, StockedProduct } from '@/lib/types';
import { DISPLAY_UNITS, formatNumber, parseQty, type BaseUnit } from '@/lib/units';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

/**
 * Confidence deliberately avoids the freshness ramp: those four colours mean
 * stock state and nothing else. A three-bar meter reads at a glance without
 * borrowing that meaning.
 */
function ConfidenceMeter({ confidence }: { confidence: number | null }) {
  const t = useTokens();
  const level = confidenceLabel(confidence);
  const filled = level === 'check' ? 1 : level === 'likely' ? 2 : 3;
  const label = level === 'check' ? 'Check this' : level === 'likely' ? 'Likely' : 'Confident';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end' }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 3,
              height: 6 + i * 3,
              borderRadius: 1,
              backgroundColor: i < filled ? t.accentText : t.lineStrong }}
          />
        ))}
      </View>
      <Text style={{ fontSize: 11, color: level === 'check' ? t.ink : t.inkFaint, fontFamily: level === 'check' ? fonts.bold : fonts.medium }}>
        {label}
      </Text>
    </View>
  );
}

export function DraftRow({
  line,
  products,
  expanded,
  onToggle,
  onChange,
  onDelete }: {
  line: DraftLine;
  products: StockedProduct[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftLine>) => void;
  onDelete: () => void;
}) {
  const t = useTokens();
  const [picking, setPicking] = useState(false);
  // Null while not being edited, so the field shows the saved value.
  const [qtyText, setQtyText] = useState<string | null>(null);
  const matched = products.find((p) => p.id === line.matched_product_id) ?? null;
  const skipped = line.resolution === 'skip';

  return (
    <View style={{ backgroundColor: t.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          opacity: skipped ? 0.5 : 1,
          backgroundColor: pressed ? t.surfaceAlt : 'transparent' })}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 15.5,
              fontFamily: fonts.semibold,
              color: t.ink,
              textDecorationLine: skipped ? 'line-through' : 'none' }}>
            {line.name}
          </Text>
          {line.raw_text ? (
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.inkFaint, fontFamily: 'monospace' }}>
              {line.raw_text}
            </Text>
          ) : null}
          {skipped ? (
            <Text style={{ fontSize: 11.5, color: t.inkFaint }}>Skipped{line.skip_reason ? ` · ${line.skip_reason}` : ''}</Text>
          ) : matched ? (
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.accentText }}>
              Adds to {matched.name}
            </Text>
          ) : (
            <Text style={{ fontSize: 11.5, color: t.inkFaint }}>New product</Text>
          )}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: t.ink, fontVariant: ['tabular-nums'] }}>
            {formatNumber(line.qty)} {line.display_unit}
          </Text>
          {!skipped ? <ConfidenceMeter confidence={line.confidence} /> : null}
        </View>
      </Pressable>

      {expanded ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg }}>
          <Field label="Name" value={line.name} onChangeText={(name) => onChange({ name })} />

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              {/* The draft string is what makes this editable at all. Bound
                  straight to line.qty, the field could never be cleared:
                  deleting the last digit leaves "", which does not parse, so
                  nothing propagated and the old number was rendered straight
                  back over the top. There was no way to reach an empty field
                  and type a different one. */}
              <Field
                label="Quantity"
                value={qtyText ?? formatNumber(line.qty)}
                keyboardType="decimal-pad"
                selectTextOnFocus
                onChangeText={(text) => {
                  setQtyText(text);
                  const qty = parseQty(text);
                  if (qty !== null) onChange({ qty });
                }}
                onBlur={() => setQtyText(null)}
              />
            </View>
          </View>

          <Segmented
            label="Unit"
            options={(['g', 'ml', 'unit'] as BaseUnit[]).flatMap((base) =>
              DISPLAY_UNITS[base].map((u) => ({ value: u.key, label: u.key }))
            )}
            value={line.display_unit}
            onChange={(display_unit) => {
              const base = (Object.keys(DISPLAY_UNITS) as BaseUnit[]).find((b) =>
                DISPLAY_UNITS[b].some((u) => u.key === display_unit)
              );
              onChange({ display_unit, base_unit: base ?? line.base_unit });
            }}
          />

          <Segmented
            label="Category"
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            value={line.category}
            onChange={(category) => onChange({ category })}
          />

          <View style={{ gap: space.sm }}>
            <Eyebrow>What to do with it</Eyebrow>
            <Segmented
              options={[
                { value: 'merge', label: 'Add to existing' },
                { value: 'new', label: 'New product' },
                { value: 'skip', label: 'Skip' },
              ]}
              value={line.resolution}
              onChange={(resolution: LineResolution) => {
                if (resolution === 'merge') setPicking(true);
                else onChange({ resolution, matched_product_id: null });
              }}
            />
            {line.resolution === 'merge' ? (
              <Pressable accessibilityRole="button" onPress={() => setPicking(true)}>
                <Text style={{ color: t.accentText, fontSize: 13, fontFamily: fonts.semibold, paddingTop: 4 }}>
                  {matched ? `Change from ${matched.name}` : 'Choose a product'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Button label="Remove this line" variant="danger" onPress={onDelete} />
        </View>
      ) : null}

      <ProductPicker
        visible={picking}
        products={products}
        onClose={() => setPicking(false)}
        onSelect={(product) => {
          onChange({
            resolution: 'merge',
            matched_product_id: product.id,
            display_unit: product.display_unit,
            base_unit: product.base_unit,
            category: product.category });
          setPicking(false);
        }}
      />
    </View>
  );
}

function ProductPicker({
  visible,
  products,
  onClose,
  onSelect }: {
  visible: boolean;
  products: StockedProduct[];
  onClose: () => void;
  onSelect: (product: StockedProduct) => void;
}) {
  const t = useTokens();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle ? products.filter((p) => p.name.toLowerCase().includes(needle)) : products;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: '#0006' }} />
      <View
        style={{
          backgroundColor: t.ground,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          maxHeight: '80%' }}>
        <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.bold, color: t.ink }}>Add to which product?</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your pantry"
            placeholderTextColor={t.inkFaint}
            autoCorrect={false}
            style={{
              backgroundColor: t.surface,
              borderColor: t.line,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
              paddingVertical: 11,
              fontSize: 15,
              color: t.ink }}
          />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: space.lg }}>
          {shown.length === 0 ? (
            <Text style={{ color: t.inkFaint, fontSize: 14, padding: space.lg, textAlign: 'center' }}>
              Nothing matches. Set the line to &ldquo;New product&rdquo; instead.
            </Text>
          ) : (
            shown.map((product) => (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                onPress={() => onSelect(product)}
                style={({ pressed }) => ({
                  paddingVertical: 13,
                  paddingHorizontal: space.lg,
                  backgroundColor: pressed ? t.surfaceAlt : t.surface,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: t.line })}>
                <Text style={{ fontSize: 15, color: t.ink, fontFamily: fonts.semibold }}>{product.name}</Text>
                <Text style={{ fontSize: 12, color: t.inkFaint, marginTop: 2 }}>
                  {product.category} · tracked in {product.display_unit}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
