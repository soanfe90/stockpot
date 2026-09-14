import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { fonts } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function TabsLayout() {
  const t = useTokens();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentText,
        tabBarInactiveTintColor: t.inkFaint,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.1 },
        // No explicit height or bottom padding: React Navigation sizes the bar
        // around the device's safe area itself, and overriding the height is
        // what pushed it under the gesture bar.
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.line,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
        },
        tabBarItemStyle: { paddingTop: 6, paddingBottom: 4 },
        sceneStyle: { backgroundColor: t.ground },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Pantry',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'file-tray-stacked' : 'file-tray-stacked-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Meals',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'restaurant' : 'restaurant-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'Shopping',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'cart' : 'cart-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
