import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, ErrorNote, Icon, Segmented, Title, type IconName } from '@/components/ui/kit';
import { scanPhoto } from '@/lib/capture';
import { errorMessage } from '@/lib/supabase';
import type { CaptureKind } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

/**
 * Where the zoom sits along the lens's range, not a magnification.
 *
 * expo-camera's `zoom` is a 0-1 fraction of whatever the device can do, and
 * Android floors the resulting ratio at 1x -- so a real 0.5x ultra-wide is not
 * reachable through this prop at all, and a "2x" label would be a guess about
 * a maximum the app cannot read. These say what they actually are.
 */
const ZOOM_STOPS = [
  { value: 0, label: '1\u00d7' },
  { value: 0.25, label: 'Closer' },
  { value: 0.5, label: 'Close' },
  { value: 0.75, label: 'Closest' },
] as const;

export default function CameraScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [kind, setKind] = useState<CaptureKind>('receipt');
  const [zoom, setZoom] = useState(0);
  const [torch, setTorch] = useState(false);
  // expo-camera has no focus-point API, so what a tap can do is ask the camera
  // to run its autofocus again: dropping the mode and restoring it next frame
  // is what makes it re-converge on whatever is in front of it now. Small
  // print on a till roll needs that far more often than a normal photo does.
  const [focusing, setFocusing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refocus() {
    setFocusing(true);
    setTimeout(() => setFocusing(false), 120);
  }

  /**
   * Pinch to zoom, on RN's own PanResponder rather than a gesture library:
   * this is the only gesture in the app, and PanResponder sees both touches
   * without needing a provider at the root of the tree.
   *
   * The pinch is tracked as a ratio against the distance the fingers started
   * at, so a given spread means the same amount of zoom wherever it begins.
   */
  const pinch = useMemo(() => {
    let startDistance = 0;
    let startZoom = 0;

    const distance = (touches: { pageX: number; pageY: number }[]) =>
      Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

    return PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderGrant: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          startDistance = distance(touches);
          startZoom = zoom;
        }
      },
      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length !== 2 || startDistance <= 0) return;
        // A quarter of the spread ratio: the full range is only 0 to 1, and
        // mapping it one-to-one makes the zoom impossible to place.
        const next = startZoom + (distance(touches) / startDistance - 1) * 0.25;
        setZoom(Math.min(1, Math.max(0, next)));
      },
      onPanResponderRelease: () => {
        startDistance = 0;
      },
    });
  }, [zoom]);

  async function handle(uri: string) {
    if (!household) return;
    setBusy(true);
    setError(null);
    try {
      const capture = await scanPhoto(household.id, kind, uri);
      router.replace(`/capture/${capture.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function shoot() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: true });
    if (photo?.uri) await handle(photo.uri);
  }

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (!result.canceled && result.assets[0]?.uri) await handle(result.assets[0].uri);
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accentText} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.ground,
          justifyContent: 'center',
          padding: space.xl,
          gap: space.lg }}>
        <Title>Camera access</Title>
        <Body>
          Stockpot needs the camera to read receipts and groceries. Photos are uploaded to your household&apos;s
          private storage and are never shared.
        </Body>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
        <Button label="Choose a photo instead" variant="secondary" onPress={() => void pick()} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={zoom}
        enableTorch={torch}
        autofocus={focusing ? 'off' : 'on'}
      />

      {/* Above the camera, below the chrome: a tap anywhere on the frame
          re-runs autofocus, which is the gesture people already expect. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Focus"
        onPress={refocus}
        style={StyleSheet.absoluteFill}
        {...pinch.panHandlers}
      />

      {/* Mode is chosen before the shot because it changes what the model is
          asked to do -- read a till roll, or identify objects. */}
      <View style={{ position: 'absolute', top: insets.top + space.md, left: 0, right: 0, paddingHorizontal: space.lg }}>
        <View style={{ backgroundColor: t.ground, borderRadius: radius.md, padding: space.md }}>
          <Segmented
            options={[
              { value: 'receipt', label: 'Receipt' },
              { value: 'products', label: 'Groceries' },
            ]}
            value={kind}
            onChange={setKind}
          />
          <Text style={{ fontSize: 12, color: t.inkFaint, marginTop: space.sm, lineHeight: 17 }}>
            {kind === 'receipt'
              ? 'Lay the receipt flat and fill the frame. Small print is what the scan reads. Pinch to zoom, tap to refocus.'
              : 'Get the packaging labels in shot — weights and volumes come from them. Pinch to zoom, tap to refocus.'}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 190 }}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + space.xl,
          paddingTop: space.xl,
          paddingHorizontal: space.lg,
          alignItems: 'center',
          gap: space.lg,
          backgroundColor: '#0009' }}>
        {busy ? (
          <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14 }}>Reading the photo…</Text>
            <Text style={{ color: '#fff9', fontSize: 12, textAlign: 'center', maxWidth: 260 }}>
              A long receipt can take a few seconds. Nothing is added to your inventory until you review it.
            </Text>
          </View>
        ) : (
          <>
            {/* Zoom presets, on the thumb's arc rather than up by the frame:
                every one of these is pressed while the other hand is holding a
                receipt flat. expo-camera takes a 0-1 fraction of whatever the
                lens can do, so these are positions along that range -- the
                phone decides what they come out as. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              {ZOOM_STOPS.map((stop) => (
                <Pressable
                  key={stop.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: Math.abs(zoom - stop.value) < 0.02 }}
                  accessibilityLabel={stop.label}
                  onPress={() => setZoom(stop.value)}
                  hitSlop={6}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: Math.abs(zoom - stop.value) < 0.02 ? '#fff' : '#0009' }}>
                  <Text
                    style={{
                      color: Math.abs(zoom - stop.value) < 0.02 ? '#111' : '#fff',
                      fontSize: 12,
                      fontFamily: fonts.semibold }}>
                    {stop.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
              <Chip
                icon={torch ? 'flashlight' : 'flashlight-outline'}
                label={torch ? 'Turn the light off' : 'Turn the light on'}
                active={torch}
                onPress={() => setTorch((on) => !on)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                onPress={() => void shoot()}
                style={({ pressed }) => ({
                  width: 74,
                  height: 74,
                  borderRadius: 37,
                  backgroundColor: '#fff',
                  borderWidth: 4,
                  borderColor: '#fff6',
                  opacity: pressed ? 0.7 : 1 })}
              />
              <Chip icon="scan-outline" label="Refocus" onPress={refocus} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable accessibilityRole="button" onPress={() => void pick()} hitSlop={10}>
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: fonts.semibold }}>Choose photo</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
                <Text style={{ color: '#fff9', fontSize: 14, fontFamily: fonts.semibold }}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** A round control over the camera preview. Fixed to the dark frame rather
 *  than the theme: there is no light-mode version of a viewfinder. */
function Chip({
  icon,
  label,
  active,
  onPress }: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#fff' : '#0009',
        opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={20} color={active ? '#111' : '#fff'} />
    </Pressable>
  );
}
