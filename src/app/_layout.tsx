import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loading } from '@/components/ui/kit';
import { HouseholdProvider, useHousehold } from '@/providers/household-provider';
import { SessionProvider, useSession } from '@/providers/session-provider';
import { ThemeProvider } from '@/theme/theme-provider';
import { fonts } from '@/theme/tokens';
import { useThemeMode, useTokens } from '@/theme/use-tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <HouseholdProvider>
            <RootNavigator />
          </HouseholdProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Four gates, in order: fonts and data ready, signed in, in a household, asked
 * about preferences, then the app. Everything downstream can assume all of
 * them, which is why no other screen checks for a null session.
 */
function RootNavigator() {
  const t = useTokens();
  const { scheme } = useThemeMode();
  const { session, loading: sessionLoading } = useSession();
  const { household, profile, loading: householdLoading } = useHousehold();
  const segments = useSegments();
  const router = useRouter();

  // Text rendered before the faces arrive falls back to the system font and
  // then reflows, so the splash holds until they are in.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  // A font that fails to load is not worth blocking the app over; the system
  // face is a worse look, not a broken one.
  const typeReady = fontsLoaded || !!fontError;
  const ready = typeReady && !sessionLoading && !householdLoading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    const root = segments[0] as string | undefined;
    const onSignIn = root === 'sign-in';
    const onOnboarding = root === 'household';
    const onSettings = root === 'settings';

    if (!session) {
      if (!onSignIn) router.replace('/sign-in');
    } else if (!household) {
      if (!onOnboarding) router.replace('/household');
    } else if (!profile?.onboarded_at) {
      if (!onSettings) router.replace('/settings');
    } else if (onSignIn || onOnboarding) {
      // Settings stays reachable once the questions are answered -- it is the
      // same screen, so it must not bounce anyone back out.
      router.replace('/');
    }
  }, [ready, session, household, profile, segments, router]);

  if (!ready) return <Loading />;

  const header = {
    headerStyle: { backgroundColor: t.ground },
    headerTintColor: t.accentText,
    headerTitleStyle: { fontFamily: fonts.display, fontSize: 17, color: t.ink },
    headerShadowVisible: false,
  } as const;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.ground } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="household" />
        <Stack.Screen name="settings" options={{ ...header, headerShown: true, title: 'Settings' }} />
        <Stack.Screen name="product/new" options={{ ...header, presentation: 'modal', headerShown: true, title: 'Add product' }} />
        <Stack.Screen name="product/[id]" options={{ ...header, headerShown: true, title: 'Product' }} />
        <Stack.Screen name="capture/camera" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="capture/[id]" options={{ ...header, headerShown: true, title: 'Review scan' }} />
        <Stack.Screen name="shopping/review" options={{ ...header, headerShown: true, title: 'Finish purchase' }} />
        <Stack.Screen name="shopping/history" options={{ ...header, headerShown: true, title: 'Past trips' }} />
        {/* gestureEnabled off: the cover blocks taps, but a swipe-to-dismiss
            would still walk out of a plan that is mid-write. */}
        <Stack.Screen
          name="plan/create"
          options={{ ...header, presentation: 'modal', headerShown: true, title: 'New plan', gestureEnabled: false }}
        />
        <Stack.Screen name="plan/[id]" options={{ ...header, headerShown: true, title: 'Review plan' }} />
        <Stack.Screen name="meal/[id]" options={{ ...header, headerShown: true, title: 'This meal' }} />
        <Stack.Screen name="cook/[id]" options={{ ...header, headerShown: true, title: 'Cooking' }} />
        <Stack.Screen name="recipe/[id]" options={{ ...header, headerShown: true, title: 'Recipe' }} />
      </Stack>
    </>
  );
}
