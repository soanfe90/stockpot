import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useTokens } from '@/theme/use-tokens';

export default function TabsLayout() {
  const t = useTokens();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentText,
        tabBarInactiveTintColor: t.inkFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.line,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
        },
        sceneStyle: { backgroundColor: t.ground },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inventory' }} />
      <Tabs.Screen name="plan" options={{ title: 'Meal plan' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="list" options={{ title: 'Shopping' }} />
    </Tabs>
  );
}
