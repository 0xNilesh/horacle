// Crypto polyfill — must be VERY first import (viem needs getRandomValues)
import 'react-native-get-random-values';

import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useEffect, useState, useRef } from 'react';
import 'react-native-reanimated';

// Import background task at module level
import '../tasks/location-task';

import { useColorScheme } from '@/components/useColorScheme';
import { getUser, type HoracleUser } from '@/lib/auth';
import { registerForPushNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

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
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Check auth state + set up push notifications
  useEffect(() => {
    getUser().then(async (u) => {
      setUser(u);

      if (u) {
        // Ensure background task has user ID (survives app kill)
        try {
          const { setBgUserId } = await import('../tasks/location-task');
          await setBgUserId(u.id);
        } catch {}

        // Register for push notifications and save token
        try {
          const token = await registerForPushNotifications();
          if (token) {
            await supabase
              .from('users')
              .update({ push_token: token })
              .eq('id', u.id);
            console.log('[Push] Token saved:', token.slice(0, 30) + '...');
          }
        } catch (err) {
          console.log('[Push] Registration skipped:', err);
        }
      }
    });

    // Handle notification tapped — navigate to answer screen
    try {
      responseListener.current = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const data = response.notification.request.content.data;
          if (data?.queryId && data?.type === 'query') {
            router.push(`/answer/${data.queryId}`);
          }
        }
      );

      notificationListener.current = Notifications.addNotificationReceivedListener(
        (notification) => {
          console.log('[Push] Received in foreground:', notification.request.content.title);
        }
      );
    } catch (err) {
      console.log('[Push] Listener setup skipped:', err);
    }

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (loaded && user !== undefined) {
      SplashScreen.hideAsync();
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
        <Stack.Screen name="answer/[queryId]" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}
