import { StyleSheet, TouchableOpacity, ScrollView, Animated, Easing, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { getCurrentLocation, requestLocationPermissions } from '@/lib/location';
import { reverseGeocode } from '@/lib/geocode';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { router } from 'expo-router';

const DURATIONS = [
  { label: '1hr', minutes: 60 },
  { label: '4hr', minutes: 240 },
  { label: '8hr', minutes: 480 },
  { label: 'Always', minutes: 52560000 },
];

export default function HomeScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(2);
  const [liveStatus, setLiveStatus] = useState('');
  const [timeLeft, setTimeLeft] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const fadeIn = useRef(new Animated.Value(0)).current;

  const isLive = session?.status === 'live';

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    getUser().then(async (u) => {
      if (u) {
        const { data: freshUser } = await supabase.from('users').select('*').eq('id', u.id).single();
        if (freshUser) {
          u = { ...u, reputation_score: freshUser.reputation_score, total_earned_usdc: freshUser.total_earned_usdc, total_queries_answered: freshUser.total_queries_answered };
        }
        try {
          const { data: sessions } = await supabase.from('live_sessions').select('*').eq('user_id', u.id).eq('status', 'live').gt('expires_at', new Date().toISOString()).order('started_at', { ascending: false }).limit(1);
          if (sessions && sessions.length > 0) setSession(sessions[0]);
        } catch {}
        try {
          const { setBgUserId } = await import('../../tasks/location-task');
          await setBgUserId(u.id);
        } catch {}
      }
      setUser(u);
    });

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Permission denied'); return; }
      const loc = await getCurrentLocation();
      if (loc) {
        setLocation(loc);
        reverseGeocode(loc.lat, loc.lng).then(setPlaceName);
        supabase.from('live_sessions').select('id', { count: 'exact', head: true }).eq('status', 'live').gt('expires_at', new Date().toISOString()).then(({ count }) => setLiveCount(count || 0));
      } else setError('Could not get location');
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!isLive || !session) return;
    const interval = setInterval(() => {
      const remaining = new Date(session.expires_at).getTime() - Date.now();
      if (remaining <= 0) { setSession(null); setTimeLeft(''); clearInterval(interval); return; }
      if (remaining > 30 * 24 * 3600000) { setTimeLeft('Always On'); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive, session]);

  const handleGoLive = async () => {
    let currentUser = user;
    if (!currentUser) { currentUser = await getUser(); if (currentUser) setUser(currentUser); }
    if (!currentUser) { setLiveStatus('Verify with World ID first'); return; }

    if (isLive) {
      const { stopLiveTracking } = await import('@/lib/location');
      await stopLiveTracking();
      await supabase.from('live_sessions').update({ status: 'ended' }).eq('user_id', currentUser.id).eq('status', 'live');
      setSession(null); setLiveStatus(''); return;
    }

    setLiveStatus('Requesting permission...');
    const perms = await requestLocationPermissions();
    if (!perms.background) { setLiveStatus('Go to Settings → Horacle → Location → Allow all the time'); return; }

    setLiveStatus('Going live...');
    try {
      const loc = await getCurrentLocation();
      if (!loc) { setLiveStatus('Could not get location'); return; }
      await supabase.from('live_sessions').update({ status: 'ended' }).eq('user_id', currentUser.id).eq('status', 'live');
      const expiresAt = new Date(Date.now() + DURATIONS[selectedDuration].minutes * 60000).toISOString();
      const { data: sessionId } = await supabase.rpc('create_live_session', { p_user_id: currentUser.id, p_lng: loc.lng, p_lat: loc.lat, p_expires_at: expiresAt });
      await supabase.rpc('upsert_location', { p_user_id: currentUser.id, p_lng: loc.lng, p_lat: loc.lat, p_accuracy: loc.accuracy });
      const { setBgUserId } = await import('../../tasks/location-task');
      await setBgUserId(currentUser.id);
      const { startLiveTracking } = await import('@/lib/location');
      await startLiveTracking();
      setSession({ id: sessionId, status: 'live', expires_at: expiresAt }); setLiveStatus('');
    } catch (err: any) { setLiveStatus(err.message); }
  };

  return (
    <View style={s.container}>
      {/* Subtle background blobs */}
      <View style={s.bgBlob1} />
      <View style={s.bgBlob2} />
      <View style={s.bgBlob3} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeIn }}>

          {/* Header */}
          <View style={s.header}>
            <View>
              <Text style={s.greeting}>Hello, human</Text>
              <Text style={s.greetingSub}>World ID verified</Text>
            </View>
            <View style={[s.statusPill, isLive && s.statusPillLive]}>
              <View style={[s.statusDot, isLive && s.statusDotLive]} />
              <Text style={[s.statusLabel, isLive && s.statusLabelLive]}>{isLive ? 'LIVE' : 'OFFLINE'}</Text>
            </View>
          </View>

          {/* Network */}
          <View style={s.networkBar}>
            <View style={s.networkDots}>
              {Array.from({ length: Math.min(liveCount, 6) }).map((_, i) => <View key={i} style={s.networkDot} />)}
            </View>
            <Text style={s.networkText}>{liveCount > 0 ? `${liveCount} on the network` : 'No one live yet'}</Text>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            {[
              { label: 'Earned', value: `$${user?.total_earned_usdc.toFixed(2) || '0.00'}` },
              { label: 'Answered', value: `${user?.total_queries_answered || 0}` },
              { label: 'Rep', value: `${user?.reputation_score.toFixed(1) || '3.0'}` },
            ].map((stat) => (
              <View key={stat.label} style={s.statCard}>
                {!user ? (
                  <ActivityIndicator size="small" color="#EEEDF5" />
                ) : (
                  <Text style={s.statValue}>{stat.value}</Text>
                )}
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Location */}
          <View style={s.locationCard}>
            <Text style={s.locationLabel}>Your position</Text>
            {loading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color="#7C5CFC" />
                <Text style={s.coordsMuted}>Getting location...</Text>
              </View>
            ) : placeName ? (
              <>
                <Text style={s.placeName}>{placeName}</Text>
                {location && <Text style={s.coords}>{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</Text>}
              </>
            ) : error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : location ? (
              <Text style={s.coords}>{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</Text>
            ) : (
              <Text style={s.coordsMuted}>Acquiring...</Text>
            )}
          </View>

          {/* Duration picker */}
          {!isLive && (
            <View style={s.durationRow}>
              {DURATIONS.map((d, i) => (
                <TouchableOpacity key={d.label} style={[s.durationBtn, i === selectedDuration && s.durationActive]} onPress={() => setSelectedDuration(i)}>
                  <Text style={[s.durationText, i === selectedDuration && s.durationTextActive]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Timer */}
          {isLive && timeLeft ? (
            <View style={s.timerCard}>
              <Text style={s.timerLabel}>{timeLeft === 'Always On' ? 'Status' : 'Remaining'}</Text>
              <Text style={s.timerValue}>{timeLeft}</Text>
            </View>
          ) : null}

          {/* CTA */}
          <TouchableOpacity style={[s.ctaBtn, isLive && s.ctaBtnStop]} onPress={handleGoLive} activeOpacity={0.8}>
            <Text style={[s.ctaText, isLive && s.ctaTextStop]}>{isLive ? 'Stop Earning' : 'Start Earning'}</Text>
            <Text style={[s.ctaSub, isLive && s.ctaSubStop]}>
              {isLive ? 'Stop answering nearby questions' : `Answer questions nearby · ~$0.40/hr`}
            </Text>
          </TouchableOpacity>

          {liveStatus ? <Text style={s.warning}>{liveStatus}</Text> : null}

          {/* How it works */}
          <View style={s.howSection}>
            <Text style={s.sectionTitle}>How it works</Text>
            {[
              { n: '1', text: 'Tap "Start Earning" at any location' },
              { n: '2', text: 'Someone nearby asks a question — you get pinged' },
              { n: '3', text: 'Reply in 10 seconds, earn $0.05 instantly' },
            ].map((step) => (
              <View key={step.n} style={s.stepRow}>
                <View style={s.stepBadge}><Text style={s.stepNum}>{step.n}</Text></View>
                <Text style={s.stepText}>{step.text}</Text>
              </View>
            ))}
          </View>

          <Text style={s.footerText}>Horacle v1.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  bgBlob1: {
    position: 'absolute', top: -40, right: -50,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(124, 92, 252, 0.04)',
  },
  bgBlob2: {
    position: 'absolute', top: 300, left: -70,
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(124, 92, 252, 0.03)',
  },
  bgBlob3: {
    position: 'absolute', bottom: 100, right: -40,
    width: 150, height: 150, borderRadius: 75,
    backgroundColor: 'rgba(52, 199, 89, 0.03)',
  },
  scroll: { padding: 20, paddingTop: 52, paddingBottom: 40 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 26, fontWeight: '700', color: '#1A1A1E', letterSpacing: -0.5 },
  greetingSub: { fontSize: 12, color: '#A0A0AB', marginTop: 2 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, backgroundColor: '#F5F5F7', borderWidth: 1, borderColor: '#E8E8EC',
  },
  statusPillLive: { backgroundColor: '#F0FAF3', borderColor: '#C8E6D0' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D0D0D8' },
  statusDotLive: { backgroundColor: '#34C759' },
  statusLabel: { fontSize: 10, fontFamily: 'SpaceMono', color: '#A0A0AB', letterSpacing: 1.5 },
  statusLabelLive: { color: '#34C759' },

  networkBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
    padding: 12, borderRadius: 12, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5',
  },
  networkDots: { flexDirection: 'row', gap: 3 },
  networkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#7C5CFC' },
  networkText: { color: '#A0A0AB', fontSize: 12 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5',
  },
  statValue: { fontSize: 20, fontWeight: '700', color: '#1A1A1E', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 10, color: '#A0A0AB', marginTop: 4, letterSpacing: 1 },

  locationCard: {
    padding: 16, borderRadius: 14, marginBottom: 16,
    backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5',
  },
  locationLabel: { fontSize: 11, color: '#A0A0AB', letterSpacing: 1, marginBottom: 6 },
  placeName: { fontSize: 15, color: '#1A1A1E', fontWeight: '600', marginBottom: 4 },
  coords: { fontSize: 13, color: '#A0A0AB', fontFamily: 'SpaceMono' },
  coordsMuted: { fontSize: 13, color: '#D0D0D8', fontFamily: 'SpaceMono' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontSize: 13, color: '#FF3B30' },

  durationRow: { flexDirection: 'row', gap: 8, marginBottom: 14, justifyContent: 'center' },
  durationBtn: {
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#F5F5F7', borderWidth: 1, borderColor: '#E8E8EC',
  },
  durationActive: { backgroundColor: '#7C5CFC', borderColor: '#7C5CFC' },
  durationText: { color: '#A0A0AB', fontSize: 13, fontWeight: '600' },
  durationTextActive: { color: '#FFFFFF' },

  timerCard: {
    alignItems: 'center', marginBottom: 14, padding: 12, borderRadius: 12,
    backgroundColor: '#F0FAF3', borderWidth: 1, borderColor: '#C8E6D0',
  },
  timerLabel: { fontSize: 10, color: '#6B9B7A', letterSpacing: 1, marginBottom: 2 },
  timerValue: { fontSize: 26, fontWeight: '700', color: '#34C759', fontFamily: 'SpaceMono' },

  ctaBtn: {
    borderRadius: 14, padding: 18, marginBottom: 12, alignItems: 'center',
    backgroundColor: '#7C5CFC',
  },
  ctaBtnStop: { backgroundColor: '#FFF0EF', borderWidth: 1, borderColor: '#FFD0CD' },
  ctaText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  ctaTextStop: { color: '#FF3B30' },
  ctaSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  ctaSubStop: { color: '#FF8A80' },

  warning: { color: '#FF9500', fontSize: 12, textAlign: 'center', marginBottom: 12 },

  howSection: { marginTop: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 14, color: '#6B6B76', fontWeight: '600', marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F5F7', borderWidth: 1, borderColor: '#E8E8EC',
  },
  stepNum: { fontSize: 12, fontWeight: '700', color: '#6B6B76' },
  stepText: { fontSize: 14, color: '#6B6B76', flex: 1 },

  footerText: { color: '#D0D0D8', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
