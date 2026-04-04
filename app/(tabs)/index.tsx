import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { getCurrentLocation, requestLocationPermissions, startLiveTracking, stopLiveTracking } from '@/lib/location';

export default function HomeScreen() {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');

  useEffect(() => {
    (async () => {
      // Request permission first
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        return;
      }
      const loc = await getCurrentLocation();
      if (loc) {
        setLocation(loc);
      } else {
        setError('Could not get location');
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Horacle</Text>
      <Text style={styles.subtitle}>Real-time intelligence from verified humans</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Location</Text>
        {location ? (
          <Text style={styles.cardText}>
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </Text>
        ) : error ? (
          <Text style={[styles.cardText, { color: '#ef4444' }]}>{error}</Text>
        ) : (
          <Text style={styles.cardText}>Requesting permission...</Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.button, isLive && styles.buttonLive]}
        onPress={async () => {
          if (isLive) {
            await stopLiveTracking();
            setIsLive(false);
            setLiveStatus('Stopped');
            return;
          }

          setLiveStatus('Requesting background permission...');
          const perms = await requestLocationPermissions();

          if (!perms.background) {
            setLiveStatus('Background location denied — need "Allow all the time"');
            return;
          }

          setLiveStatus('Starting live tracking...');
          try {
            await startLiveTracking();
            setIsLive(true);
            setLiveStatus('You are LIVE — tracking every 15 seconds');
          } catch (err: any) {
            setLiveStatus(`Error: ${err.message}`);
          }
        }}
      >
        <Text style={styles.buttonText}>{isLive ? 'Stop Live' : 'Go Live'}</Text>
      </TouchableOpacity>

      {liveStatus ? (
        <Text style={[styles.hint, isLive && { color: '#10b981' }]}>{liveStatus}</Text>
      ) : null}

      <Text style={styles.hint}>
        Phase 0 — Check the Spike Tests tab to verify all systems
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
    marginTop: 4,
    marginBottom: 30,
  },
  card: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.5,
    marginBottom: 4,
  },
  cardText: {
    fontSize: 16,
    fontFamily: 'SpaceMono',
  },
  button: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    marginBottom: 10,
  },
  buttonLive: {
    backgroundColor: '#ef4444',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  hint: {
    fontSize: 12,
    opacity: 0.4,
    textAlign: 'center',
  },
});
