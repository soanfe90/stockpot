import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

// The navigator's own bar is 49pt of content plus the safe-area inset, and an
// icon over a label only just fits in 49 -- on a phone with a gesture bar the
// label bled into it. BAR_CONTENT is that content box, sized to leave real
// clearance; the inset is added back on so the bar still ends above the
// gesture bar rather than under it.
const BAR_CONTENT = 56;

export default function TabsLayout() {
  const t = useTokens();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentText,
        tabBarInactiveTintColor: t.inkFaint,
        // lineHeight is pinned because Figtree's own metrics are taller than
        // the fontSize, and an unpinned label is what overflowed the bar.
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.1 },
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.line,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          height: BAR_CONTENT + insets.bottom,
        },
        // Deliberately no bottom padding here: the navigator already pads the
        // bar by insets.bottom, so adding more would double-count the inset.
        tabBarItemStyle: { paddingTop: 7, paddingBottom: 6 },
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
