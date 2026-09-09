import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, ErrorNote, Segmented, Title } from '@/components/ui/kit';
import { scanPhoto } from '@/lib/capture';
import { errorMessage } from '@/lib/supabase';
import type { CaptureKind } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function CameraScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [kind, setKind] = useState<CaptureKind>('receipt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          gap: space.lg,
        }}>
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
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

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
              ? 'Lay the receipt flat and fill the frame. Small print is what the scan reads.'
              : 'Get the packaging labels in shot — weights and volumes come from them.'}
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
          backgroundColor: '#0009',
        }}>
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
                opacity: pressed ? 0.7 : 1,
              })}
            />
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable accessibilityRole="button" onPress={() => void pick()} hitSlop={10}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Choose photo</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
                <Text style={{ color: '#fff9', fontSize: 14, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
