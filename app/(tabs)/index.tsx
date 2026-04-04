import { StyleSheet, TouchableOpacity, ScrollView, Animated, Easing, Dimensions } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { getCurrentLocation, requestLocationPermissions } from '@/lib/location';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
// import { goLive, stopLive, getActiveLiveSession, type LiveSession } from '@/lib/live-session';
import { router } from 'expo-router';

const { width } = Dimensions.get('window');
const DURATIONS = [
  { label: '1hr', minutes: 60 },
  { label: '4hr', minutes: 240 },
  { label: '8hr', minutes: 480 },
  { label: 'Always', minutes: 52560000 }, // ~100 years
];

function RadarPulse({ active }: { active: boolean }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!active) return;
    const pulse = () => {
      scale.setValue(0.3);
      opacity.setValue(0.5);
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.8, duration: 2500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 2500, useNativeDriver: true }),
      ]).start(pulse);
    };
    pulse();
  }, [active]);

  if (!active) return null;
  return <Animated.View style={[s.radar, { transform: [{ scale }], opacity }]} pointerEvents="none" />;
}

export default function HomeScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(2); // index into DURATIONS
  const [liveStatus, setLiveStatus] = useState('');
  const [timeLeft, setTimeLeft] = useState('');
  const fadeIn = useRef(new Animated.Value(0)).current;

  const isLive = session?.status === 'live';

  // Load user + location + check existing session
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    getUser().then(setUser);

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Permission denied'); return; }
      const loc = await getCurrentLocation();
      if (loc) setLocation(loc);
      else setError('Could not get location');
    })();
  }, []);

  // Countdown timer when live
  useEffect(() => {
    if (!isLive || !session) return;
    const interval = setInterval(() => {
      const remaining = new Date(session.expires_at).getTime() - Date.now();
      if (remaining <= 0) {
        setSession(null);
        setTimeLeft('');
        clearInterval(interval);
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive, session]);

  const handleGoLive = async () => {
    // Reload user if not loaded yet
    let currentUser = user;
    if (!currentUser) {
      currentUser = await getUser();
      if (currentUser) setUser(currentUser);
    }
    if (!currentUser) {
      setLiveStatus('Not logged in — verify with World ID first');
      return;
    }

    if (isLive) {
      const { stopLiveTracking } = await import('@/lib/location');
      await stopLiveTracking();
      setSession(null);
      setLiveStatus('');
      return;
    }

    setLiveStatus('Requesting permission...');
    const perms = await requestLocationPermissions();
    if (!perms.background) {
      setLiveStatus('Go to Settings → Apps → Horacle → Permissions → Location → "Allow all the time"');
      return;
    }

    setLiveStatus('Going live...');
    try {
      const { startLiveTracking } = await import('@/lib/location');
      await startLiveTracking();
      setSession({ status: 'live', expires_at: new Date(Date.now() + DURATIONS[selectedDuration].minutes * 60000).toISOString() });
      setLiveStatus('');
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
            <View style={[s.statusPill, isLive && s.statusPillLive]}>
              <View style={[s.statusDot, isLive && s.statusDotLive]} />
              <Text style={[s.statusLabel, isLive && s.statusLabelLive]}>
                {isLive ? 'LIVE' : 'OFFLINE'}
              </Text>
            </View>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            {[
              { emoji: '💰', value: `$${user?.total_earned_usdc.toFixed(2) || '0.00'}`, label: 'EARNED' },
              { emoji: '💬', value: `${user?.total_queries_answered || 0}`, label: 'ANSWERED' },
              { emoji: '⭐', value: `${user?.reputation_score.toFixed(1) || '3.0'}`, label: 'REP' },
            ].map((stat) => (
              <View key={stat.label} style={s.statCard}>
                <Text style={s.statEmoji}>{stat.emoji}</Text>
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Location card with radar */}
          <View style={s.locationCard}>
            <RadarPulse active={isLive} />
            <View style={s.locationHeader}>
              <Text style={s.locationLabel}>YOUR POSITION</Text>
              {location && <View style={s.locationDot} />}
            </View>
            {location ? (
              <View style={s.coordsRow}>
                <Text style={s.coordVal}>{location.lat.toFixed(6)}</Text>
                <Text style={s.coordSep}>·</Text>
                <Text style={s.coordVal}>{location.lng.toFixed(6)}</Text>
              </View>
            ) : error ? (
              <Text style={s.locError}>{error}</Text>
            ) : (
              <Text style={s.locLoading}>acquiring signal...</Text>
            )}

            {/* Crosshair */}
            <View style={s.crosshair}>
              <View style={s.crossH} />
              <View style={s.crossV} />
              <View style={[s.crossDot, isLive && s.crossDotLive]} />
            </View>
          </View>

          {/* Duration selector (only when not live) */}
          {!isLive && (
            <View style={s.durationRow}>
              {DURATIONS.map((d, i) => (
                <TouchableOpacity
                  key={d.label}
                  style={[s.durationBtn, i === selectedDuration && s.durationBtnActive]}
                  onPress={() => setSelectedDuration(i)}
                >
                  <Text style={[s.durationText, i === selectedDuration && s.durationTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Timer when live */}
          {isLive && timeLeft ? (
            <View style={s.timerCard}>
              <Text style={s.timerLabel}>{DURATIONS[selectedDuration].minutes >= 52560000 ? 'STATUS' : 'TIME REMAINING'}</Text>
              <Text style={s.timerValue}>{DURATIONS[selectedDuration].minutes >= 52560000 ? 'Always On' : timeLeft}</Text>
            </View>
          ) : null}

          {/* Go Live / Stop Button */}
          <TouchableOpacity onPress={handleGoLive} activeOpacity={0.85}>
            <LinearGradient
              colors={isLive ? ['#dc2626', '#991b1b'] : ['#a78bfa', '#7c3aed']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.liveBtn}
            >
              <View style={s.liveBtnInner}>
                <View style={[s.livePulse, isLive && s.livePulseActive]} />
                <Text style={s.liveBtnText}>{isLive ? 'STOP EARNING' : 'START EARNING'}</Text>
              </View>
              <Text style={s.liveBtnSub}>
                {isLive
                  ? 'Stop answering nearby questions'
                  : `Answer questions nearby · ~$0.40/hr${DURATIONS[selectedDuration].label === 'Always' ? '' : ` · ${DURATIONS[selectedDuration].label}`}`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {liveStatus ? <Text style={s.warning}>{liveStatus}</Text> : null}

          {/* How it works */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>HOW IT WORKS</Text>
            {[
              { n: '01', icon: '📍', text: 'Tap "Start Earning" at any location' },
              { n: '02', icon: '🔔', text: 'Someone nearby asks a question — you get pinged' },
              { n: '03', icon: '💸', text: 'Reply in 10 seconds, earn $0.05 instantly' },
            ].map((step, i) => (
              <View key={step.n} style={s.stepRow}>
                <View style={s.stepBadge}><Text style={s.stepNum}>{step.n}</Text></View>
                <Text style={s.stepIcon}>{step.icon}</Text>
                <Text style={s.stepText}>{step.text}</Text>
              </View>
            ))}
          </View>

          {/* Footer */}
          {user && (
            <View style={s.footer}>
              <Text style={s.footerId}>ID: {user.world_id_nullifier.slice(0, 14)}...</Text>
              <TouchableOpacity onPress={async () => { await clearUser(); router.replace('/(auth)/verify'); }}>
                <Text style={s.logout}>Sign out</Text>
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

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  greeting: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  greetingSub: { fontSize: 11, color: 'rgba(167,139,250,0.6)', marginTop: 2, fontFamily: 'SpaceMono' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  statusPillLive: { backgroundColor: 'rgba(167,139,250,0.08)', borderColor: 'rgba(167,139,250,0.25)' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  statusDotLive: {
    backgroundColor: '#a78bfa',
    shadowColor: '#a78bfa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6, elevation: 6,
  },
  statusLabel: { fontSize: 10, fontFamily: 'SpaceMono', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5 },
  statusLabelLive: { color: '#a78bfa' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, padding: 14, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  statEmoji: { fontSize: 18, marginBottom: 6 },
  statValue: { fontSize: 18, fontWeight: '800', color: '#fff', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 4, letterSpacing: 1.5 },

  locationCard: {
    borderRadius: 16, padding: 20, marginBottom: 16, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.1)',
    alignItems: 'center', minHeight: 140, justifyContent: 'center',
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  locationLabel: { fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: 2.5, fontFamily: 'SpaceMono' },
  locationDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a78bfa' },
  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coordVal: { fontSize: 20, fontFamily: 'SpaceMono', color: 'rgba(255,255,255,0.7)' },
  coordSep: { fontSize: 20, color: 'rgba(167,139,250,0.3)' },
  locError: { color: '#f87171', fontSize: 13, fontFamily: 'SpaceMono' },
  locLoading: { color: 'rgba(255,255,255,0.15)', fontSize: 13, fontFamily: 'SpaceMono' },

  crosshair: { position: 'absolute', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 40, height: 1, backgroundColor: 'rgba(167,139,250,0.1)' },
  crossV: { position: 'absolute', width: 1, height: 40, backgroundColor: 'rgba(167,139,250,0.1)' },
  crossDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(167,139,250,0.2)' },
  crossDotLive: {
    backgroundColor: '#a78bfa',
    shadowColor: '#a78bfa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 6,
  },

  radar: {
    position: 'absolute', width: 100, height: 100, borderRadius: 50,
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.3)',
  },

  durationRow: { flexDirection: 'row', gap: 8, marginBottom: 14, justifyContent: 'center' },
  durationBtn: {
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  durationBtnActive: { backgroundColor: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.3)' },
  durationText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: '600' },
  durationTextActive: { color: '#a78bfa' },

  timerCard: {
    alignItems: 'center', marginBottom: 14, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
  },
  timerLabel: { fontSize: 9, color: 'rgba(167,139,250,0.5)', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 4 },
  timerValue: { fontSize: 28, fontWeight: '900', color: '#a78bfa', fontFamily: 'SpaceMono' },

  liveBtn: { borderRadius: 16, padding: 20, marginBottom: 12 },
  liveBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  livePulse: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.3)' },
  livePulseActive: {
    backgroundColor: '#fff',
    shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 6,
  },
  liveBtnText: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  liveBtnSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginLeft: 24 },

  warning: { color: 'rgba(250,200,50,0.8)', fontSize: 11, fontFamily: 'SpaceMono', textAlign: 'center', marginBottom: 12 },

  section: { marginTop: 12, marginBottom: 20 },
  sectionTitle: { fontSize: 10, color: 'rgba(255,255,255,0.15)', letterSpacing: 3, fontFamily: 'SpaceMono', marginBottom: 18 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  stepBadge: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
  },
  stepNum: { fontSize: 10, fontFamily: 'SpaceMono', color: 'rgba(167,139,250,0.5)' },
  stepIcon: { fontSize: 16 },
  stepText: { fontSize: 14, color: 'rgba(255,255,255,0.45)', flex: 1 },

  footer: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)', paddingTop: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  footerId: { fontSize: 10, color: 'rgba(255,255,255,0.12)', fontFamily: 'SpaceMono' },
  logout: { color: 'rgba(255,255,255,0.15)', fontSize: 12 },
});
