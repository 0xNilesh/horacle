import { StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, Dimensions, Image } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { verifyWithWorldID, verifyProofOnBackend } from '@/lib/worldid';
import { registerUser, getUser } from '@/lib/auth';
import { useDynamic, showDynamicAuth } from '@/lib/dynamic';

type VerifyState = 'idle' | 'verifying' | 'registering' | 'wallet' | 'success' | 'error';
const { width } = Dimensions.get('window');

function FloatingOrb() {
  const rotation = useRef(new Animated.Value(0)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring3Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.3)).current;
  const ring2Opacity = useRef(new Animated.Value(0.2)).current;
  const ring3Opacity = useRef(new Animated.Value(0.1)).current;

  useEffect(() => {
    // Rotate orb
    Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 25000, easing: Easing.linear, useNativeDriver: true })).start();

    // Pulse rings
    const pulseRing = (scale: Animated.Value, opacity: Animated.Value, delay: number) => {
      setTimeout(() => {
        const pulse = () => {
          Animated.parallel([
            Animated.sequence([
              Animated.timing(scale, { toValue: 1.15, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.timing(scale, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
            Animated.sequence([
              Animated.timing(opacity, { toValue: 0.5, duration: 2500, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.15, duration: 2500, useNativeDriver: true }),
            ]),
          ]).start(pulse);
        };
        pulse();
      }, delay);
    };

    pulseRing(ring1Scale, ring1Opacity, 0);
    pulseRing(ring2Scale, ring2Opacity, 800);
    pulseRing(ring3Scale, ring3Opacity, 1600);
  }, []);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={s.orbContainer}>
      {/* Outer rings */}
      <Animated.View style={[s.ring, s.ring3, { transform: [{ scale: ring3Scale }], opacity: ring3Opacity }]} />
      <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
      <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />

      {/* Orb */}
      <Animated.View style={[s.orbWrap, { transform: [{ rotate: spin }] }]}>
        <Image source={require('@/assets/images/hero-ball.png')} style={s.orbImage} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

export default function VerifyScreen() {
  const [state, setState] = useState<VerifyState>('idle');
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [storedNullifier, setStoredNullifier] = useState('');
  const { wallets, auth } = useDynamic();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  const [stats, setStats] = useState({ users: 0, questions: 0, live: 0 });
  const appId = process.env.EXPO_PUBLIC_APP_ID || '';

  useEffect(() => {
    // Fetch app-wide stats
    (async () => {
      try {
        const { supabase } = await import('@/lib/supabase');
        const [{ count: users }, { count: questions }, { count: live }] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }),
          supabase.from('queries').select('id', { count: 'exact', head: true }),
          supabase.from('live_sessions').select('id', { count: 'exact', head: true }).eq('status', 'live').gt('expires_at', new Date().toISOString()),
        ]);
        setStats({ users: users || 0, questions: questions || 0, live: live || 0 });
      } catch {}
    })();

    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const handleVerify = async () => {
    if (!appId || appId === 'app_xxxxx') { setErrorText('Set EXPO_PUBLIC_APP_ID in .env'); setState('error'); return; }
    setState('verifying'); setStatusText('Opening World App...'); setErrorText('');
    const result = await verifyWithWorldID(appId, 'register');
    if (!result.success || !result.proof) { setErrorText(result.error || 'Verification failed'); setState('error'); return; }
    setState('registering'); setStatusText('Verifying proof...');
    const backendResult = await verifyProofOnBackend(appId, 'register', result.proof);
    if (!backendResult.success) { setErrorText(`${backendResult.error}`); setState('error'); return; }
    const nullifier = backendResult.nullifier_hash || result.proof.nullifier_hash;
    setStatusText('Creating account...');
    const placeholderWallet = `0x${nullifier.slice(2, 42)}`;
    const r = await registerUser(nullifier, placeholderWallet);
    if (r.error) { setErrorText(r.error); setState('error'); return; }
    setStoredNullifier(nullifier);
    setState('wallet');
  };

  const handleConnectWallet = () => { setStatusText('Opening wallet...'); showDynamicAuth(); };

  useEffect(() => {
    if (state === 'wallet' && wallets && wallets.length > 0) {
      (async () => {
        setState('registering'); setStatusText('Connecting wallet...');
        const { supabase } = await import('@/lib/supabase');
        const user = await getUser();
        if (user) await supabase.from('users').update({ wallet_address: wallets[0].address }).eq('id', user.id);
        setState('success'); setStatusText("You're in.");
        setTimeout(() => router.replace('/(tabs)'), 1200);
      })();
    }
  }, [wallets, state]);

  const handleDevSkip = async () => {
    setState('registering'); setStatusText('Creating account...');
    const dn = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const dw = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const r = await registerUser(dn, dw);
    if (r.error) { setErrorText(r.error); setState('error'); }
    else { setState('success'); setStatusText("You're in."); setTimeout(() => router.replace('/(tabs)'), 1200); }
  };

  return (
    <View style={s.container}>
      {/* Center */}
      <Animated.View style={[s.center, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
        <FloatingOrb />
        <Text style={s.title}>Horacle</Text>
        <Text style={s.tagline}>Real-time intelligence{'\n'}from verified humans</Text>

        <View style={s.pillRow}>
          {['$0.05/answer', 'Go Live anywhere', 'World ID'].map((t) => (
            <View key={t} style={s.pill}><Text style={s.pillText}>{t}</Text></View>
          ))}
        </View>

        {/* Live analytics */}
        <View style={s.analyticsRow}>
          <View style={s.analyticItem}>
            <Text style={s.analyticValue}>{stats.users}</Text>
            <Text style={s.analyticLabel}>Humans</Text>
          </View>
          <View style={s.analyticDivider} />
          <View style={s.analyticItem}>
            <Text style={s.analyticValue}>{stats.questions}</Text>
            <Text style={s.analyticLabel}>Questions</Text>
          </View>
          <View style={s.analyticDivider} />
          <View style={s.analyticItem}>
            <Text style={[s.analyticValue, stats.live > 0 && s.analyticLive]}>{stats.live}</Text>
            <Text style={s.analyticLabel}>Live now</Text>
          </View>
        </View>
      </Animated.View>

      {/* Bottom */}
      <Animated.View style={[s.bottom, { opacity: fadeIn }]}>
        {state === 'idle' && (
          <>
            <TouchableOpacity style={s.verifyBtn} onPress={handleVerify} activeOpacity={0.8}>
              <Text style={s.verifyBtnText}>Verify with World ID</Text>
            </TouchableOpacity>
            <Text style={s.disclaimer}>Proves you're a unique human.{'\n'}One person, one account.</Text>
            <TouchableOpacity style={s.devBtn} onPress={handleDevSkip}>
              <Text style={s.devBtnText}>skip — dev mode</Text>
            </TouchableOpacity>
          </>
        )}

        {(state === 'verifying' || state === 'registering') && (
          <View style={s.statusWrap}>
            <ActivityIndicator size="large" color="#1A1A1E" />
            <Text style={s.statusLabel}>{statusText}</Text>
            {state === 'verifying' && <Text style={s.statusHint}>Complete in World App</Text>}
          </View>
        )}

        {state === 'wallet' && (
          <View style={s.statusWrap}>
            <Text style={s.walletDone}>World ID verified</Text>
            <Text style={s.walletTitle}>Connect your wallet</Text>
            <Text style={s.walletDesc}>Required for earning and payments</Text>
            <TouchableOpacity style={s.verifyBtn} onPress={handleConnectWallet}>
              <Text style={s.verifyBtnText}>Connect Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.devBtn} onPress={() => { setState('success'); setStatusText("You're in."); setTimeout(() => router.replace('/(tabs)'), 1200); }}>
              <Text style={s.devBtnText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'success' && (
          <View style={s.statusWrap}>
            <View style={s.successCircle}><Text style={s.successCheck}>✓</Text></View>
            <Text style={s.successLabel}>{statusText}</Text>
          </View>
        )}

        {state === 'error' && (
          <View style={s.statusWrap}>
            <Text style={s.errorLabel}>{errorText}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => setState('idle')}>
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  bgBlob1: {
    position: 'absolute', top: -80, right: -60,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(124, 92, 252, 0.06)',
  },
  bgBlob2: {
    position: 'absolute', bottom: 40, left: -80,
    width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(124, 92, 252, 0.04)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  orbContainer: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1.5 },
  ring1: { width: 160, height: 160, borderColor: '#B8A8F0', borderWidth: 2 },
  ring2: { width: 180, height: 180, borderColor: '#C8BBF2', borderWidth: 1.5 },
  ring3: { width: 200, height: 200, borderColor: '#D8D0F5', borderWidth: 1.5 },
  orbWrap: { width: 130, height: 130 },
  orbImage: { width: 130, height: 130 },

  title: { fontSize: 34, fontWeight: '800', color: '#1A1A1E', letterSpacing: -1 },
  tagline: { fontSize: 15, color: '#A0A0AB', textAlign: 'center', marginTop: 8, lineHeight: 22 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 24 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F5F5F7', borderWidth: 1, borderColor: '#E8E8EC' },
  pillText: { color: '#6B6B76', fontSize: 12, fontWeight: '500' },

  analyticsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 28,
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14,
    backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5',
  },
  analyticItem: { flex: 1, alignItems: 'center' },
  analyticValue: { fontSize: 22, fontWeight: '700', color: '#1A1A2E', fontFamily: 'SpaceMono' },
  analyticLive: { color: '#34C759' },
  analyticLabel: { fontSize: 11, color: '#A5A4B4', marginTop: 2 },
  analyticDivider: { width: 1, height: 30, backgroundColor: '#EEEDF5' },

  bottom: { paddingHorizontal: 24, paddingBottom: 36 },

  verifyBtn: { borderRadius: 14, paddingVertical: 18, alignItems: 'center', backgroundColor: '#7C5CFC', marginBottom: 14 },
  verifyBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  disclaimer: { color: '#A0A0AB', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  devBtn: { alignSelf: 'center', marginTop: 16, padding: 8 },
  devBtnText: { color: '#D0D0D8', fontSize: 12 },

  statusWrap: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  statusLabel: { color: '#1A1A1E', fontSize: 16, fontWeight: '500' },
  statusHint: { color: '#A0A0AB', fontSize: 12 },

  walletDone: { color: '#34C759', fontSize: 13, fontWeight: '600' },
  walletTitle: { color: '#1A1A1E', fontSize: 20, fontWeight: '700' },
  walletDesc: { color: '#A0A0AB', fontSize: 13, marginBottom: 8 },

  successCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F0FAF3', borderWidth: 2, borderColor: '#34C759', alignItems: 'center', justifyContent: 'center' },
  successCheck: { fontSize: 24, color: '#34C759' },
  successLabel: { color: '#34C759', fontSize: 20, fontWeight: '700' },

  errorLabel: { color: '#FF3B30', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1, borderColor: '#E8E8EC' },
  retryText: { color: '#1A1A1E', fontWeight: '600' },
});
