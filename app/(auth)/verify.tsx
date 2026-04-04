import { StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, Dimensions, Image } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { verifyWithWorldID, verifyProofOnBackend } from '@/lib/worldid';
import { registerUser } from '@/lib/auth';

type VerifyState = 'idle' | 'verifying' | 'registering' | 'success' | 'error';
const { width, height } = Dimensions.get('window');

// Floating particles like stars
function StarField() {
  const stars = useRef(
    Array.from({ length: 30 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.7 + height * 0.05,
      size: 1 + Math.random() * 2,
      opacity: new Animated.Value(Math.random() * 0.3),
    }))
  ).current;

  useEffect(() => {
    stars.forEach((star) => {
      const twinkle = () => {
        Animated.sequence([
          Animated.timing(star.opacity, {
            toValue: 0.1 + Math.random() * 0.5,
            duration: 1000 + Math.random() * 3000,
            useNativeDriver: true,
          }),
          Animated.timing(star.opacity, {
            toValue: 0.02,
            duration: 1000 + Math.random() * 3000,
            useNativeDriver: true,
          }),
        ]).start(twinkle);
      };
      setTimeout(twinkle, Math.random() * 2000);
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stars.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: s.x, top: s.y,
            width: s.size, height: s.size, borderRadius: s.size,
            backgroundColor: '#c4b5fd', opacity: s.opacity,
          }}
        />
      ))}
    </View>
  );
}

// Hero ball with slow rotation + glowing ring
function GlowingOrb() {
  const rotation = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    // Slow continuous rotation
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulsing ring + glow
    const pulse = () => {
      Animated.parallel([
        Animated.sequence([
          Animated.timing(ringScale, { toValue: 1.12, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringScale, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(glow, { toValue: 0.45, duration: 2500, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.15, duration: 2500, useNativeDriver: true }),
        ]),
      ]).start(pulse);
    };
    pulse();
  }, []);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={s.orbWrap}>
      <Animated.View style={[s.orbGlow, { opacity: glow }]} />
      <Animated.View style={[s.orbRing, { transform: [{ scale: ringScale }] }]} />
      <Animated.View style={[s.orbImageWrap, { transform: [{ rotate: spin }] }]}>
        <Image
          source={require('@/assets/images/hero-ball.png')}
          style={s.orbImage}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

export default function VerifyScreen() {
  const [state, setState] = useState<VerifyState>('idle');
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  const appId = process.env.EXPO_PUBLIC_APP_ID || '';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const handleVerify = async () => {
    if (!appId || appId === 'app_xxxxx') { setErrorText('Set EXPO_PUBLIC_APP_ID in .env first'); setState('error'); return; }
    setState('verifying'); setStatusText('Opening World App...'); setErrorText('');
    const result = await verifyWithWorldID(appId, 'register');
    if (!result.success || !result.proof) { setErrorText(result.error || 'Verification failed'); setState('error'); return; }
    setState('registering'); setStatusText('Verifying proof...');
    const backendResult = await verifyProofOnBackend(appId, 'register', result.proof);
    if (!backendResult.success) { setErrorText(`Verification failed: ${backendResult.error}`); setState('error'); return; }
    setStatusText('Creating account...');
    const nullifier = backendResult.nullifier_hash || result.proof.nullifier_hash;
    const walletAddress = `0x${nullifier.slice(2, 42)}`;
    const r = await registerUser(nullifier, walletAddress);
    if (r.error) { setErrorText(r.error); setState('error'); return; }
    setState('success'); setStatusText("You're in.");
    setTimeout(() => router.replace('/(tabs)'), 1200);
  };

  const handleDevSkip = async () => {
    setState('registering'); setStatusText('Creating dev account...');
    const dn = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const dw = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const r = await registerUser(dn, dw);
    if (r.error) { setErrorText(r.error); setState('error'); }
    else { setState('success'); setStatusText("You're in."); setTimeout(() => router.replace('/(tabs)'), 1200); }
  };

  return (
    <View style={s.container}>
      <LinearGradient
        colors={['#000000', '#0a0015', '#050010', '#000000']}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.ambientGlow} />
      <StarField />

      {/* Top badge */}
      <Animated.View style={[s.topBadge, { opacity: fadeIn }]}>
        <View style={s.topDot} />
        <Text style={s.topText}>HUMAN VERIFICATION REQUIRED</Text>
      </Animated.View>

      {/* Center */}
      <Animated.View style={[s.center, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
        <GlowingOrb />
        <Text style={s.title}>Horacle</Text>
        <Text style={s.tagline}>Real-time intelligence{'\n'}from verified humans.</Text>

        <View style={s.pillRow}>
          {['Earn $0.05/answer', 'Go Live anywhere', 'World ID verified'].map((t) => (
            <View key={t} style={s.pill}>
              <Text style={s.pillText}>{t}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Bottom actions */}
      <Animated.View style={[s.bottom, { opacity: fadeIn }]}>
        {state === 'idle' && (
          <>
            <TouchableOpacity style={s.verifyBtn} onPress={handleVerify} activeOpacity={0.85}>
              <LinearGradient
                colors={['#a78bfa', '#7c3aed']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.verifyGradient}
              >
                <Text style={s.verifyText}>Verify with World ID</Text>
                <Text style={s.verifyArrow}>→</Text>
              </LinearGradient>
            </TouchableOpacity>

            <Text style={s.disclaimer}>
              Proves you're a unique human.{'\n'}One person. One account. Real reputation.
            </Text>

            <TouchableOpacity style={s.devBtn} onPress={handleDevSkip}>
              <Text style={s.devText}>skip — dev mode</Text>
            </TouchableOpacity>
          </>
        )}

        {(state === 'verifying' || state === 'registering') && (
          <View style={s.statusWrap}>
            <ActivityIndicator size="large" color="#a78bfa" />
            <Text style={s.statusLabel}>{statusText}</Text>
            {state === 'verifying' && <Text style={s.statusHint}>Complete verification in World App</Text>}
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

      <Text style={s.version}>v1.0 — ETHGlobal Cannes 2026</Text>
    </View>
  );
}

const ORB = 140;
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  ambientGlow: {
    position: 'absolute', top: height * 0.22, left: width * 0.5 - 150,
    width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(124,58,237,0.1)',
  },

  topBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 56, gap: 8,
    backgroundColor: 'rgba(167,139,250,0.06)', paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(167,139,250,0.12)',
  },
  topDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a78bfa' },
  topText: { color: '#a78bfa', fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  orbWrap: { width: ORB + 60, height: ORB + 60, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  orbGlow: {
    position: 'absolute', width: ORB + 60, height: ORB + 60, borderRadius: (ORB + 60) / 2,
    backgroundColor: 'rgba(124,58,237,0.2)',
  },
  orbRing: {
    position: 'absolute', width: ORB + 20, height: ORB + 20, borderRadius: (ORB + 20) / 2,
    borderWidth: 1.5, borderColor: 'rgba(167,139,250,0.25)',
  },
  orbImageWrap: { width: ORB, height: ORB },
  orbImage: { width: ORB, height: ORB },

  title: { fontSize: 38, fontWeight: '900', color: '#fff', letterSpacing: -1.5 },
  tagline: { fontSize: 15, color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 10, lineHeight: 22 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 24 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)', backgroundColor: 'rgba(167,139,250,0.05)',
  },
  pillText: { color: 'rgba(167,139,250,0.7)', fontSize: 11, fontFamily: 'SpaceMono' },

  bottom: { paddingHorizontal: 24, paddingBottom: 24 },

  verifyBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 14 },
  verifyGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 10,
  },
  verifyText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  verifyArrow: { color: 'rgba(255,255,255,0.6)', fontSize: 20 },

  disclaimer: { color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  devBtn: { alignSelf: 'center', marginTop: 16, padding: 8 },
  devText: { color: 'rgba(255,255,255,0.15)', fontSize: 11, fontFamily: 'SpaceMono' },

  statusWrap: { alignItems: 'center', gap: 14, paddingVertical: 20 },
  statusLabel: { color: '#fff', fontSize: 16, fontWeight: '500' },
  statusHint: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },

  successCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(167,139,250,0.15)',
    borderWidth: 2, borderColor: '#a78bfa', alignItems: 'center', justifyContent: 'center',
  },
  successCheck: { fontSize: 26, color: '#a78bfa' },
  successLabel: { color: '#a78bfa', fontSize: 22, fontWeight: '700' },

  errorLabel: { color: '#f87171', fontSize: 13, textAlign: 'center', fontFamily: 'SpaceMono', lineHeight: 20 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  retryText: { color: '#fff', fontWeight: '500' },

  version: { color: 'rgba(255,255,255,0.08)', fontSize: 10, fontFamily: 'SpaceMono', textAlign: 'center', paddingBottom: 14 },
});
