import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';

import { backOr } from '@/lib/navigation';
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

/** How far one press of the zoom buttons moves along the lens's range. Fine
 *  enough to frame small print on a till roll without overshooting it. */
const ZOOM_STEP = 0.05;

export default function CameraScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household, profile } = useHousehold();

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
  const [reticle, setReticle] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Tapping the preview re-runs autofocus.
   *
   * expo-camera has no focus-*point* API, so where the tap landed cannot be
   * passed to the camera -- what a tap can do is make it converge again on
   * whatever is in front of it. The reticle is drawn at the tap anyway,
   * because a control that does its work invisibly reads as a broken one, and
   * this is the feedback that makes the gesture legible.
   */
  function focusAt(x: number, y: number) {
    setReticle({ x, y });
    setFocusing(true);
    setTimeout(() => setFocusing(false), 120);
    setTimeout(() => setReticle(null), 700);
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
      const capture = await scanPhoto(household.id, kind, uri, profile?.llm_model ?? null);
      router.replace(`/capture/${capture.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function shoot() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: true });
    // The light has done its job. Leaving it on shines it at whoever is
    // holding the phone for as long as the scan takes, and drains the battery
    // while they read the results.
    setTorch(false);
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
        <Button label="Cancel" variant="ghost" onPress={() => backOr(router, '/')} />
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
        onPress={(e) => focusAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        style={StyleSheet.absoluteFill}
        {...pinch.panHandlers}
      />

      {reticle ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: reticle.x - 36,
            top: reticle.y - 36,
            width: 72,
            height: 72,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: '#fff' }}
        />
      ) : null}

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
              ? 'Lay the receipt flat and fill the frame. Small print is what the scan reads. Tap anywhere to focus, pinch or use the buttons to zoom.'
              : 'Get the packaging labels in shot — weights and volumes come from them. Tap anywhere to focus, pinch or use the buttons to zoom.'}
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
            {/* Zoom, on the thumb's arc rather than up by the frame: these are
                pressed while the other hand holds a receipt flat.

                expo-camera takes a 0-1 fraction of whatever the lens can do,
                and the app cannot read what that maximum is -- so the readout
                is a position along the range and not a magnification. A "2x"
                here would be a guess about someone else's hardware. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Chip
                icon="remove"
                label="Zoom out"
                disabled={zoom <= 0}
                onPress={() => setZoom((z) => Math.max(0, Math.round((z - ZOOM_STEP) * 100) / 100))}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset zoom"
                onPress={() => setZoom(0)}
                hitSlop={8}
                style={{
                  minWidth: 74,
                  alignItems: 'center',
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  backgroundColor: '#0009' }}>
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 12.5,
                    fontFamily: fonts.semibold,
                    fontVariant: ['tabular-nums'] }}>
                  {zoom <= 0 ? 'No zoom' : `Zoom ${Math.round(zoom * 100)}%`}
                </Text>
              </Pressable>
              <Chip
                icon="add"
                label="Zoom in"
                disabled={zoom >= 1}
                onPress={() => setZoom((z) => Math.min(1, Math.round((z + ZOOM_STEP) * 100) / 100))}
              />
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
              <Chip icon="images-outline" label="Choose a photo instead" onPress={() => void pick()} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable accessibilityRole="button" onPress={() => backOr(router, '/')} hitSlop={10}>
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
  disabled,
  onPress }: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#fff' : '#0009',
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={20} color={active ? '#111' : '#fff'} />
    </Pressable>
  );
}
