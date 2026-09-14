import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/kit';
import { Text } from '@/components/ui/text';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

/**
 * A blocking cover for work that cannot be left half-done.
 *
 * Generating a plan writes a plan, its recipes, their ingredients and their
 * slots across several round trips. Wandering off mid-way does not stop any of
 * that -- it just means nobody is there when it lands, and the half-written
 * plan has nobody to approve or discard it. So the screen is held: no back
 * gesture, no tabs, one way out and it is labelled.
 *
 * The bar does not claim to know how far along the work is, because it cannot:
 * a single model call either has not answered yet or has. It sweeps to say the
 * app is alive, and the step captions say what is actually happening.
 */
export function Working({
  title,
  steps,
  note,
  onCancel }: {
  title: string;
  /** Shown in order, one every few seconds, so a long wait still reads as
   *  progress rather than as a hang. */
  steps: string[];
  note?: string;
  onCancel: () => void;
}) {
  const t = useTokens();
  const sweep = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [sweep]);

  useEffect(() => {
    if (steps.length < 2) return;
    // Stops on the last one rather than looping: claiming to start over would
    // be a lie about what the work is doing.
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 4000);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Android's back button routes here; swallowing it is what makes the
      // screen actually locked rather than merely covered.
      onRequestClose={() => undefined}
      statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: '#000000cc',
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.xl }}>
        <View
          style={{
            width: '100%',
            maxWidth: 380,
            backgroundColor: t.surface,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: t.line,
            padding: space.xl,
            gap: space.lg }}>
          <Text style={{ fontSize: 19, fontFamily: fonts.display, color: t.ink }}>{title}</Text>

          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
            <Animated.View
              style={{
                width: '40%',
                height: '100%',
                borderRadius: 3,
                backgroundColor: t.accent,
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      // Off one edge to off the other, in the bar's own widths.
                      outputRange: [-160, 400],
                    }),
                  },
                ],
              }}
            />
          </View>

          <Text style={{ fontSize: 14, color: t.inkMuted, lineHeight: 20 }}>{steps[step]}</Text>
          {note ? <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>{note}</Text> : null}

          <Button label="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}
