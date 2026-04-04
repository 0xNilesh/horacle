import { StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useState } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { requestLocationPermissions, getCurrentLocation, startLiveTracking, stopLiveTracking } from '@/lib/location';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  detail: string;
}

export default function SpikeScreen() {
  const [results, setResults] = useState<TestResult[]>([
    { name: 'T0.1 Foreground Location', status: 'pending', detail: '' },
    { name: 'T0.2 Background Location Permission', status: 'pending', detail: '' },
    { name: 'T0.3 Background Tracking Start', status: 'pending', detail: '' },
    { name: 'T0.4 Push Notification Token', status: 'pending', detail: '' },
    { name: 'T0.5 Supabase Connection', status: 'pending', detail: '' },
    { name: 'T0.6 Wallet Generation', status: 'pending', detail: '' },
    { name: 'T0.7 World ID Deep Link', status: 'pending', detail: '' },
  ]);

  const update = (index: number, status: 'pass' | 'fail' | 'running', detail: string) => {
    setResults(prev =>
      prev.map((r, i) => (i === index ? { ...r, status, detail } : r))
    );
  };

  const testForegroundLocation = async () => {
    update(0, 'running', 'Requesting permission...');
    try {
      const loc = await getCurrentLocation();
      if (loc) {
        update(0, 'pass', `lat: ${loc.lat.toFixed(5)}, lng: ${loc.lng.toFixed(5)}, accuracy: ${loc.accuracy?.toFixed(0)}m`);
      } else {
        update(0, 'fail', 'Could not get location — check permissions');
      }
    } catch (err: any) {
      update(0, 'fail', err.message);
    }
  };

  const testBackgroundPermission = async () => {
    update(1, 'running', 'Requesting background permission...');
    try {
      const perms = await requestLocationPermissions();
      if (perms.background) {
        update(1, 'pass', 'Background location: GRANTED');
      } else if (perms.foreground) {
        update(1, 'fail', 'Foreground granted but background DENIED');
      } else {
        update(1, 'fail', 'All location permissions denied');
      }
    } catch (err: any) {
      update(1, 'fail', err.message);
    }
  };

  const testBackgroundTracking = async () => {
    update(2, 'running', 'Starting background tracking...');
    try {
      await startLiveTracking();
      update(2, 'pass', 'Background tracking started! Check Supabase for location updates. Stopping in 30s...');
      setTimeout(async () => {
        await stopLiveTracking();
        update(2, 'pass', 'Background tracking started and stopped successfully');
      }, 30000);
    } catch (err: any) {
      update(2, 'fail', err.message);
    }
  };

  const testPushToken = async () => {
    update(3, 'running', 'Getting push token...');
    try {
      // Dynamic import — expo-notifications crashes Expo Go on SDK 53+
      const { registerForPushNotifications } = await import('@/lib/notifications');
      const token = await registerForPushNotifications();
      if (token) {
        update(3, 'pass', `Token: ${token.slice(0, 30)}...`);
      } else {
        update(3, 'fail', 'No token — need a dev build (not Expo Go). Run: eas build --profile development --platform android');
      }
    } catch (err: any) {
      if (err.message?.includes('removed from Expo Go') || err.message?.includes('dev-client')) {
        update(3, 'fail', 'Not supported in Expo Go. Need dev build: eas build --profile development --platform android');
      } else {
        update(3, 'fail', err.message);
      }
    }
  };

  const testSupabase = async () => {
    update(4, 'running', 'Connecting to Supabase...');
    try {
      const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
      if (!url || url.includes('xxxxx')) {
        update(4, 'fail', 'Placeholder env vars — update .env');
        return;
      }
      const { error } = await supabase.from('users').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        update(4, 'fail', error.message);
      } else {
        update(4, 'pass', 'Connected to Supabase');
      }
    } catch (err: any) {
      update(4, 'fail', err.message);
    }
  };

  const testWallet = async () => {
    update(5, 'running', 'Generating wallet...');
    try {
      // Ensure polyfill is loaded
      await import('react-native-get-random-values');
      const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
      const key = generatePrivateKey();
      const account = privateKeyToAccount(key);
      update(5, 'pass', `Address: ${account.address.slice(0, 20)}... Key: ${key.length} chars`);
    } catch (err: any) {
      update(5, 'fail', err.message);
    }
  };

  const testWorldIdDeepLink = async () => {
    update(6, 'running', 'Opening World App...');
    try {
      // Try multiple URL schemes to find one that works
      const urls = [
        'worldapp://',                              // World App custom scheme
        'https://world.org/verify',                 // Universal link
        'https://worldcoin.org/verify',             // Legacy universal link
      ];

      for (const url of urls) {
        try {
          const canOpen = await Linking.canOpenURL(url);
          if (canOpen) {
            await Linking.openURL(url);
            update(6, 'pass', `World App opened via: ${url}`);
            return;
          }
        } catch {
          continue;
        }
      }

      // If none worked, try force-opening the most likely one
      try {
        await Linking.openURL('https://world.org/verify');
        update(6, 'pass', 'Opened world.org/verify — check if World App caught it');
      } catch (err: any) {
        update(6, 'fail', 'No World App URL scheme worked. Is World App installed? Try opening it manually first.');
      }
    } catch (err: any) {
      update(6, 'fail', err.message);
    }
  };

  const runAll = async () => {
    testForegroundLocation();
    testPushToken();
    testSupabase();
    testWallet();
  };

  const statusColor = (s: string) => {
    if (s === 'pass') return '#10b981';
    if (s === 'fail') return '#ef4444';
    if (s === 'running') return '#f59e0b';
    return '#888';
  };

  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.container}>
        <Text style={styles.title}>Phase 0 — Risk Spikes</Text>
        <Text style={styles.subtitle}>Verify all critical systems before building</Text>

        <TouchableOpacity style={styles.runAllBtn} onPress={runAll}>
          <Text style={styles.runAllText}>Run Safe Tests</Text>
        </TouchableOpacity>

        {results.map((r, i) => (
          <View key={r.name} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{r.name}</Text>
              <Text style={[styles.cardStatus, { color: statusColor(r.status) }]}>
                {r.status.toUpperCase()}
              </Text>
            </View>
            {r.detail ? <Text style={styles.cardDetail}>{r.detail}</Text> : null}

            {/* Individual trigger buttons for risky tests */}
            {i === 1 && r.status === 'pending' && (
              <TouchableOpacity style={styles.triggerBtn} onPress={testBackgroundPermission}>
                <Text style={styles.triggerText}>Request Background Permission</Text>
              </TouchableOpacity>
            )}
            {i === 2 && r.status === 'pending' && (
              <TouchableOpacity style={styles.triggerBtn} onPress={testBackgroundTracking}>
                <Text style={styles.triggerText}>Start Background Tracking (30s test)</Text>
              </TouchableOpacity>
            )}
            {i === 6 && r.status === 'pending' && (
              <TouchableOpacity style={styles.triggerBtn} onPress={testWorldIdDeepLink}>
                <Text style={styles.triggerText}>Open World App</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 13, opacity: 0.5, marginBottom: 16 },
  runAllBtn: {
    backgroundColor: '#3b82f6',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  runAllText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  card: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.2)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardName: { fontSize: 14, fontWeight: '600', flex: 1 },
  cardStatus: { fontSize: 12, fontWeight: 'bold' },
  cardDetail: { fontSize: 11, opacity: 0.6, marginTop: 6, fontFamily: 'SpaceMono' },
  triggerBtn: {
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderRadius: 8,
    alignItems: 'center',
  },
  triggerText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
});
