import { StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { getCurrentLocation, requestLocationPermissions, startLiveTracking, stopLiveTracking } from '@/lib/location';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { router } from 'expo-router';

export default function HomeScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');

  useEffect(() => {
    getUser().then(setUser);
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        return;
      }
      const loc = await getCurrentLocation();
      if (loc) setLocation(loc);
      else setError('Could not get location');
    })();
  }, []);

  const handleGoLive = async () => {
    if (isLive) {
      await stopLiveTracking();
      setIsLive(false);
      setLiveStatus('');
      return;
    }

    setLiveStatus('Requesting permission...');
    const perms = await requestLocationPermissions();
    if (!perms.background) {
      setLiveStatus('Need "Allow all the time" permission');
      return;
    }

    try {
      await startLiveTracking();
      setIsLive(true);
      setLiveStatus('Tracking every 15s');
    } catch (err: any) {
      setLiveStatus(err.message);
    }
  };

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Hello, human.</Text>
            <Text style={s.headerSub}>
              {user ? `ID: ${user.world_id_nullifier.slice(0, 10)}...` : 'Not verified'}
            </Text>
          </View>
          <View style={[s.statusDot, isLive && s.statusDotLive]} />
        </View>

        {/* Stats Row */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>${user?.total_earned_usdc.toFixed(2) || '0.00'}</Text>
            <Text style={s.statLabel}>earned</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{user?.total_queries_answered || 0}</Text>
            <Text style={s.statLabel}>answered</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{user?.reputation_score.toFixed(1) || '3.0'}</Text>
            <Text style={s.statLabel}>reputation</Text>
          </View>
        </View>

        {/* Location Card */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>CURRENT POSITION</Text>
            <Text style={s.cardLabelRight}>
              {location ? `±${10}m` : '---'}
            </Text>
          </View>
          {location ? (
            <Text style={s.coordText}>
              {location.lat.toFixed(6)}{'\n'}{location.lng.toFixed(6)}
            </Text>
          ) : error ? (
            <Text style={s.errorSmall}>{error}</Text>
          ) : (
            <Text style={s.dimText}>acquiring signal...</Text>
          )}
        </View>

        {/* Go Live Button */}
        <TouchableOpacity
          style={[s.liveBtn, isLive && s.liveBtnActive]}
          onPress={handleGoLive}
          activeOpacity={0.8}
        >
          <View style={s.liveBtnInner}>
            <View style={[s.livePulse, isLive && s.livePulseActive]} />
            <Text style={[s.liveBtnText, isLive && s.liveBtnTextActive]}>
              {isLive ? 'LIVE' : 'GO LIVE'}
            </Text>
          </View>
          <Text style={s.liveBtnSub}>
            {isLive ? liveStatus : 'Start earning from nearby questions'}
          </Text>
        </TouchableOpacity>

        {liveStatus && !isLive ? (
          <Text style={s.statusMsg}>{liveStatus}</Text>
        ) : null}

        {/* How it works */}
        <View style={s.howSection}>
          <Text style={s.sectionTitle}>HOW IT WORKS</Text>
          {[
            { step: '01', text: 'Go Live at your location' },
            { step: '02', text: 'Get notified when someone asks nearby' },
            { step: '03', text: 'Answer in 10 seconds, earn $0.05' },
          ].map((item) => (
            <View key={item.step} style={s.howRow}>
              <Text style={s.howStep}>{item.step}</Text>
              <Text style={s.howText}>{item.text}</Text>
            </View>
          ))}
        </View>

        {/* Account section */}
        <View style={s.accountSection}>
          <TouchableOpacity
            onPress={async () => {
              await clearUser();
              router.replace('/(auth)/verify');
            }}
          >
            <Text style={s.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scroll: {
    padding: 20,
    paddingTop: 56,
    paddingBottom: 40,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: 'SpaceMono',
    color: 'rgba(255,255,255,0.25)',
    marginTop: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statusDotLive: {
    backgroundColor: '#00ff88',
    borderColor: 'rgba(0, 255, 136, 0.3)',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    fontFamily: 'SpaceMono',
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Location card
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 2,
    fontFamily: 'SpaceMono',
  },
  cardLabelRight: {
    fontSize: 10,
    color: 'rgba(0, 255, 136, 0.5)',
    fontFamily: 'SpaceMono',
  },
  coordText: {
    fontSize: 20,
    fontFamily: 'SpaceMono',
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 28,
  },
  errorSmall: {
    fontSize: 13,
    color: '#ff4444',
    fontFamily: 'SpaceMono',
  },
  dimText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.2)',
    fontFamily: 'SpaceMono',
  },

  // Go Live
  liveBtn: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 136, 0.15)',
  },
  liveBtnActive: {
    backgroundColor: 'rgba(0, 255, 136, 0.08)',
    borderColor: '#00ff88',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 4,
  },
  liveBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  livePulse: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  livePulseActive: {
    backgroundColor: '#00ff88',
    shadowColor: '#00ff88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  liveBtnText: {
    fontSize: 20,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 2,
  },
  liveBtnTextActive: {
    color: '#00ff88',
  },
  liveBtnSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    marginLeft: 26,
  },
  statusMsg: {
    fontSize: 11,
    color: 'rgba(255, 200, 50, 0.7)',
    fontFamily: 'SpaceMono',
    textAlign: 'center',
    marginBottom: 12,
  },

  // How it works
  howSection: {
    marginTop: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 3,
    fontFamily: 'SpaceMono',
    marginBottom: 16,
  },
  howRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  howStep: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(0, 255, 136, 0.4)',
    fontFamily: 'SpaceMono',
    width: 24,
  },
  howText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    flex: 1,
  },

  // Account
  accountSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 16,
    alignItems: 'center',
  },
  logoutText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 13,
  },
});
