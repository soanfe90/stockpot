import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Loading } from '@/components/ui/kit';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HouseholdProvider, useHousehold } from '@/providers/household-provider';
import { SessionProvider, useSession } from '@/providers/session-provider';
import { themes } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <HouseholdProvider>
          <RootNavigator />
        </HouseholdProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Three gates, in order: signed in, then in a household, then the app.
 * Everything downstream can assume both, which is why no other screen
 * checks for a null session.
 */
function RootNavigator() {
  const scheme = useColorScheme();
  const t = themes[scheme === 'dark' ? 'dark' : 'light'];
  const { session, loading: sessionLoading } = useSession();
  const { household, loading: householdLoading } = useHousehold();
  const segments = useSegments();
  const router = useRouter();

  const ready = !sessionLoading && !householdLoading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    const root = segments[0] as string | undefined;
    const onSignIn = root === 'sign-in';
    const onOnboarding = root === 'household';

    if (!session) {
      if (!onSignIn) router.replace('/sign-in');
    } else if (!household) {
      if (!onOnboarding) router.replace('/household');
    } else if (onSignIn || onOnboarding) {
      router.replace('/');
    }
  }, [ready, session, household, segments, router]);

  if (!ready) return <Loading />;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.ground },
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="household" />
        <Stack.Screen
          name="product/new"
          options={{ presentation: 'modal', headerShown: true, title: 'Add product' }}
        />
        <Stack.Screen name="product/[id]" options={{ headerShown: true, title: 'Product' }} />
        <Stack.Screen
          name="capture/camera"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="capture/[id]"
          options={{ headerShown: true, title: 'Review scan', headerBackTitle: 'Back' }}
        />
      </Stack>
    </>
  );
}
