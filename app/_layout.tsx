// Crypto polyfill — must be VERY first import (viem needs getRandomValues)
import 'react-native-get-random-values';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

// Import background task at module level
import '../tasks/location-task';

import { useColorScheme } from '@/components/useColorScheme';
import { getUser, type HoracleUser } from '@/lib/auth';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  const [user, setUser] = useState<HoracleUser | null | undefined>(undefined);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Check auth state on mount
  useEffect(() => {
    getUser().then((u) => {
      setUser(u);
    });
  }, []);

  useEffect(() => {
    if (loaded && user !== undefined) {
      SplashScreen.hideAsync();
      // Route based on auth state
      if (user) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/verify');
      }
    }
  }, [loaded, user]);

  if (!loaded || user === undefined) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
