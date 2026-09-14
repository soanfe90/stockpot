import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftRow } from '@/components/inventory/draft-row';
import { Button, EmptyState, ErrorNote, Eyebrow, Loading } from '@/components/ui/kit';
import { commitCapture, deleteLine, loadCapture, rescan, reviewOrder, updateLine } from '@/lib/capture';
import { formatDate } from '@/lib/expiry';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Capture, DraftLine, StockedProduct } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { fonts, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function DraftTrayScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [capture, setCapture] = useState<Capture | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [products, setProducts] = useState<StockedProduct[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !household) return;
    try {
      const [tray, catalog] = await Promise.all([
        loadCapture(id),
        supabase.from('product').select('*').eq('household_id', household.id),
      ]);
      setCapture(tray.capture);
      setLines(tray.lines);
      setProducts((catalog.data ?? []) as StockedProduct[]);
      if (tray.capture.status === 'failed') setError(tray.capture.error);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, household]);

  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(() => reviewOrder(lines), [lines]);
  const keeping = lines.filter((l) => l.resolution !== 'skip');
  const needsCheck = keeping.filter((l) => (l.confidence ?? 1) < 0.6).length;

  /** Optimistic: the row updates immediately and the write follows. A failed
   *  write reloads from the server rather than leaving a lie on screen. */
  function patch(line: DraftLine, changes: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...changes } : l)));
    updateLine(line.id, changes).catch((e) => {
      setError(errorMessage(e));
      void load();
    });
  }

  function remove(line: DraftLine) {
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    deleteLine(line.id).catch((e) => {
      setError(errorMessage(e));
      void load();
    });
  }

  async function commit() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await commitCapture(id);
      Alert.alert(
        'Added to inventory',
        [
          `${summary.lines_committed} item${summary.lines_committed === 1 ? '' : 's'} added`,
          summary.products_created ? `${summary.products_created} new product${summary.products_created === 1 ? '' : 's'}` : null,
          summary.lines_skipped ? `${summary.lines_skipped} skipped` : null,
          summary.aliases_learned
            ? `${summary.aliases_learned} receipt line${summary.aliases_learned === 1 ? '' : 's'} remembered for next time`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
        [{ text: 'Done', onPress: () => router.replace('/') }]
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await rescan(id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  if (capture?.status === 'failed' || (!lines.length && capture?.status !== 'ready')) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg, gap: space.lg }}>
        <ErrorNote message={error ?? capture?.error ?? 'That scan produced nothing.'} />
        <EmptyState
          title="The scan came back empty"
          body="A flat, well-lit photo that fills the frame reads best. You can try again on the same photo, or add the items by hand."
          action={<Button label="Read the photo again" onPress={retry} busy={busy} />}
        />
        <Button label="Back to inventory" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Eyebrow>Review before adding</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>
            {keeping.length} item{keeping.length === 1 ? '' : 's'} to add
          </Text>
          <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
            {capture?.store ? `${capture.store} · ` : ''}
            {capture?.purchased_on ? formatDate(capture.purchased_on) : 'No date on the receipt'}
            {needsCheck > 0 ? ` · ${needsCheck} worth checking, listed first` : ''}
          </Text>
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17, marginTop: 4 }}>
            Nothing has been added yet. Tap a line to correct it — every correction you make is remembered, so the
            next scan of this shop needs less of them.
          </Text>
        </View>

        {error ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
            <ErrorNote message={error} />
          </View>
        ) : null}

        <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }}>
          {ordered.map((line) => (
            <DraftRow
              key={line.id}
              line={line}
              products={products}
              expanded={expanded === line.id}
              onToggle={() => setExpanded(expanded === line.id ? null : line.id)}
              onChange={(changes) => patch(line, changes)}
              onDelete={() => remove(line)}
            />
          ))}
        </View>

        <View style={{ padding: space.lg }}>
          <Button label="Read the photo again" variant="ghost" onPress={retry} busy={busy} />
        </View>
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: t.ground,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: t.line }}>
        <Button
          label={keeping.length ? `Add ${keeping.length} to inventory` : 'Nothing to add'}
          onPress={commit}
          busy={busy}
          disabled={!keeping.length}
        />
      </View>
    </View>
  );
}
