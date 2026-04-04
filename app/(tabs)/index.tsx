import { StyleSheet, TouchableOpacity, ScrollView, Animated, Easing, Dimensions } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { getCurrentLocation, requestLocationPermissions, startLiveTracking, stopLiveTracking } from '@/lib/location';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { router } from 'expo-router';

const { width } = Dimensions.get('window');

// Animated radar sweep for live mode
function RadarPulse({ isLive }: { isLive: boolean }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!isLive) return;
    const pulse = () => {
      scale.setValue(0.3);
      opacity.setValue(0.6);
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.5, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ]).start(pulse);
    };
    pulse();
  }, [isLive]);

  if (!isLive) return null;

  return (
    <Animated.View
      style={[s.radarPulse, { transform: [{ scale }], opacity }]}
      pointerEvents="none"
    />
  );
}

export default function HomeScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getUser().then(setUser);
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Permission denied'); return; }
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
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeIn }}>

          {/* Header */}
          <View style={s.header}>
            <View>
              <Text style={s.greeting}>Hello, human.</Text>
              <Text style={s.greetingSub}>Verified with World ID</Text>
            </View>
            <View style={s.headerRight}>
              <View style={[s.statusIndicator, isLive && s.statusLive]}>
                <View style={[s.statusDotSmall, isLive && s.statusDotLive]} />
                <Text style={[s.statusText, isLive && s.statusTextLive]}>
                  {isLive ? 'LIVE' : 'OFFLINE'}
                </Text>
              </View>
            </View>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statEmoji}>💰</Text>
              <Text style={s.statValue}>${user?.total_earned_usdc.toFixed(2) || '0.00'}</Text>
              <Text style={s.statLabel}>EARNED</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statEmoji}>💬</Text>
              <Text style={s.statValue}>{user?.total_queries_answered || 0}</Text>
              <Text style={s.statLabel}>ANSWERED</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statEmoji}>⭐</Text>
              <Text style={s.statValue}>{user?.reputation_score.toFixed(1) || '3.0'}</Text>
              <Text style={s.statLabel}>REPUTATION</Text>
            </View>
          </View>

          {/* Location visualization */}
          <View style={s.locationCard}>
            <LinearGradient
              colors={['rgba(167,139,250,0.03)', 'rgba(0,0,0,0)']}
              style={s.locationGradient}
            />
            <RadarPulse isLive={isLive} />

            <View style={s.locationHeader}>
              <Text style={s.locationLabel}>YOUR POSITION</Text>
              {location && <View style={s.locationLiveDot} />}
            </View>

            {location ? (
              <View style={s.coordsWrap}>
                <Text style={s.coordValue}>{location.lat.toFixed(6)}</Text>
                <Text style={s.coordSeparator}>·</Text>
                <Text style={s.coordValue}>{location.lng.toFixed(6)}</Text>
              </View>
            ) : error ? (
              <Text style={s.locationError}>{error}</Text>
            ) : (
              <Text style={s.locationLoading}>acquiring signal...</Text>
            )}

            {/* Decorative crosshair */}
            <View style={s.crosshair}>
              <View style={s.crossH} />
              <View style={s.crossV} />
              <View style={[s.crossCenter, isLive && s.crossCenterLive]} />
            </View>
          </View>

          {/* Go Live Button */}
          <TouchableOpacity onPress={handleGoLive} activeOpacity={0.85}>
            <View style={[s.liveBtn, isLive && s.liveBtnActive]}>
              <LinearGradient
                colors={isLive ? ['rgba(255,60,60,0.15)', 'rgba(255,60,60,0.05)'] : ['rgba(167,139,250,0.08)', 'rgba(167,139,250,0.02)']}
                style={s.liveBtnGradient}
              >
                <View style={s.liveBtnTop}>
                  <View style={[s.liveDot, isLive && s.liveDotActive]} />
                  <Text style={[s.liveBtnTitle, isLive && s.liveBtnTitleActive]}>
                    {isLive ? 'STOP LIVE' : 'GO LIVE'}
                  </Text>
                </View>
                <Text style={s.liveBtnDesc}>
                  {isLive ? liveStatus || 'Broadcasting your location' : 'Start earning from nearby questions'}
                </Text>
              </LinearGradient>
            </View>
          </TouchableOpacity>

          {liveStatus && !isLive ? (
            <Text style={s.warningText}>{liveStatus}</Text>
          ) : null}

          {/* How it works */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>HOW IT WORKS</Text>
            {[
              { num: '01', icon: '📍', text: 'Go Live at any location' },
              { num: '02', icon: '🔔', text: 'Get notified when someone asks nearby' },
              { num: '03', icon: '💸', text: 'Answer in 10s, earn $0.05 instantly' },
            ].map((step, i) => (
              <View key={step.num} style={s.stepRow}>
                <View style={s.stepNumWrap}>
                  <Text style={s.stepNum}>{step.num}</Text>
                </View>
                <View style={s.stepContent}>
                  <Text style={s.stepIcon}>{step.icon}</Text>
                  <Text style={s.stepText}>{step.text}</Text>
                </View>
                {i < 2 && <View style={s.stepLine} />}
              </View>
            ))}
          </View>

          {/* User info */}
          {user && (
            <View style={s.userSection}>
              <View style={s.userRow}>
                <Text style={s.userLabel}>ID</Text>
                <Text style={s.userId}>{user.world_id_nullifier.slice(0, 14)}...</Text>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  await clearUser();
                  router.replace('/(auth)/verify');
                }}
              >
                <Text style={s.logoutText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          )}

        </Animated.View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scroll: { padding: 20, paddingTop: 52, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  greeting: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  greetingSub: { fontSize: 12, color: 'rgba(167,139,250,0.5)', marginTop: 2, fontFamily: 'SpaceMono' },
  headerRight: { paddingTop: 4 },
  statusIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  statusLive: { backgroundColor: 'rgba(167,139,250,0.06)', borderColor: 'rgba(167,139,250,0.2)' },
  statusDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  statusDotLive: {
    backgroundColor: '#a78bfa',
    shadowColor: '#a78bfa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6, elevation: 6,
  },
  statusText: { fontSize: 10, fontFamily: 'SpaceMono', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5 },
  statusTextLive: { color: '#a78bfa' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  statEmoji: { fontSize: 18, marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#fff', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 4, letterSpacing: 1.5 },

  // Location
  locationCard: {
    borderRadius: 16, padding: 20, marginBottom: 16, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.08)',
    alignItems: 'center', minHeight: 160, justifyContent: 'center',
  },
  locationGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  locationLabel: { fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: 2.5, fontFamily: 'SpaceMono' },
  locationLiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a78bfa' },
  coordsWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coordValue: { fontSize: 22, fontFamily: 'SpaceMono', color: 'rgba(255,255,255,0.7)' },
  coordSeparator: { fontSize: 22, color: 'rgba(167,139,250,0.3)' },
  locationError: { color: '#ff4444', fontSize: 13, fontFamily: 'SpaceMono' },
  locationLoading: { color: 'rgba(255,255,255,0.15)', fontSize: 13, fontFamily: 'SpaceMono' },

  crosshair: { position: 'absolute', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 40, height: 1, backgroundColor: 'rgba(167,139,250,0.1)' },
  crossV: { position: 'absolute', width: 1, height: 40, backgroundColor: 'rgba(167,139,250,0.1)' },
  crossCenter: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(167,139,250,0.2)' },
  crossCenterLive: {
    backgroundColor: '#a78bfa',
    shadowColor: '#a78bfa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 6,
  },

  radarPulse: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.3)',
  },

  // Go Live
  liveBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 12, borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.12)' },
  liveBtnActive: { borderColor: 'rgba(255,60,60,0.25)' },
  liveBtnGradient: { padding: 20 },
  liveBtnTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  liveDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2, borderColor: 'rgba(167,139,250,0.3)',
  },
  liveDotActive: {
    backgroundColor: '#a78bfa', borderColor: '#a78bfa',
    shadowColor: '#a78bfa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 10, elevation: 8,
  },
  liveBtnTitle: { fontSize: 22, fontWeight: '900', color: 'rgba(255,255,255,0.4)', letterSpacing: 2 },
  liveBtnTitleActive: { color: '#ff4444' },
  liveBtnDesc: { color: 'rgba(255,255,255,0.2)', fontSize: 12, marginLeft: 24 },

  warningText: { color: 'rgba(255,200,50,0.7)', fontSize: 11, fontFamily: 'SpaceMono', textAlign: 'center', marginBottom: 12 },

  // How it works
  section: { marginTop: 12, marginBottom: 20 },
  sectionTitle: { fontSize: 10, color: 'rgba(255,255,255,0.15)', letterSpacing: 3, fontFamily: 'SpaceMono', marginBottom: 20 },
  stepRow: { marginBottom: 16, position: 'relative' },
  stepNumWrap: {
    position: 'absolute', left: 0, top: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { fontSize: 10, fontFamily: 'SpaceMono', color: 'rgba(167,139,250,0.5)' },
  stepContent: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 40 },
  stepIcon: { fontSize: 16 },
  stepText: { fontSize: 14, color: 'rgba(255,255,255,0.45)', flex: 1 },
  stepLine: {
    position: 'absolute', left: 13, top: 30, width: 1, height: 16,
    backgroundColor: 'rgba(167,139,250,0.08)',
  },

  // User
  userSection: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
    paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userLabel: { fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'SpaceMono' },
  userId: { fontSize: 11, color: 'rgba(255,255,255,0.15)', fontFamily: 'SpaceMono' },
  logoutText: { color: 'rgba(255,255,255,0.15)', fontSize: 12 },
});
