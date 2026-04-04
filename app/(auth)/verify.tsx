import { StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, View } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { verifyWithWorldID, verifyProofOnBackend } from '@/lib/worldid';
import { registerUser } from '@/lib/auth';

type VerifyState = 'idle' | 'verifying' | 'registering' | 'success' | 'error';

export default function VerifyScreen() {
  const [state, setState] = useState<VerifyState>('idle');
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  const appId = process.env.EXPO_PUBLIC_APP_ID || '';

  const handleVerify = async () => {
    if (!appId || appId === 'app_xxxxx') {
      setErrorText('Set EXPO_PUBLIC_APP_ID in .env first');
      setState('error');
      return;
    }

    setState('verifying');
    setStatusText('Opening World App...');
    setErrorText('');

    const result = await verifyWithWorldID(appId, 'register');

    if (!result.success || !result.proof) {
      setErrorText(result.error || 'Verification failed');
      setState('error');
      return;
    }

    setState('registering');
    setStatusText('Verifying proof...');

    // Server-side verification with World API
    const backendResult = await verifyProofOnBackend(appId, 'register', result.proof);

    if (!backendResult.success) {
      setErrorText(`Verification failed: ${backendResult.error}`);
      setState('error');
      return;
    }

    const nullifier = backendResult.nullifier_hash || result.proof.nullifier_hash;

    setStatusText('Creating account...');
    const walletAddress = `0x${nullifier.slice(2, 42)}`;
    const result2 = await registerUser(nullifier, walletAddress);

    if (result2.error) {
      setErrorText(result2.error);
      setState('error');
      return;
    }

    setState('success');
    setStatusText("You're in.");
    setTimeout(() => router.replace('/(tabs)'), 1200);
  };

  const handleDevSkip = async () => {
    setState('registering');
    setStatusText('Creating dev account...');
    const devNullifier = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const devWallet = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const r = await registerUser(devNullifier, devWallet);
    if (r.error) {
      setErrorText(r.error);
      setState('error');
    } else {
      setState('success');
      setStatusText("You're in.");
      setTimeout(() => router.replace('/(tabs)'), 1200);
    }
  };

  return (
    <View style={s.container}>
      {/* Background glow */}
      <View style={s.bgGlow} />

      {/* Grid lines */}
      <View style={s.gridOverlay}>
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={[s.gridLine, { top: `${(i + 1) * 12}%` }]} />
        ))}
      </View>

      {/* Top label */}
      <View style={s.topLabel}>
        <View style={s.dot} />
        <Text style={s.topLabelText}>HUMAN VERIFICATION REQUIRED</Text>
      </View>

      {/* Main content */}
      <View style={s.content}>
        <Text style={s.brand}>H</Text>
        <Text style={s.title}>Horacle</Text>
        <Text style={s.tagline}>Real-time intelligence{'\n'}from verified humans.</Text>

        <View style={s.pillRow}>
          {['Earn $0.05/answer', 'Go Live anywhere', 'World ID verified'].map((t) => (
            <View key={t} style={s.pill}>
              <Text style={s.pillText}>{t}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Actions */}
      <View style={s.actions}>
        {state === 'idle' && (
          <>
            <TouchableOpacity style={s.verifyBtn} onPress={handleVerify} activeOpacity={0.8}>
              <Text style={s.verifyBtnText}>Verify with World ID</Text>
            </TouchableOpacity>

            <Text style={s.disclaimer}>
              Proves you're a unique human.{'\n'}One person. One account. Real reputation.
            </Text>

            <TouchableOpacity style={s.devBtn} onPress={handleDevSkip}>
              <Text style={s.devBtnText}>skip — dev mode</Text>
            </TouchableOpacity>
          </>
        )}

        {(state === 'verifying' || state === 'registering') && (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color="#00ff88" />
            <Text style={s.loadingText}>{statusText}</Text>
            {state === 'verifying' && (
              <Text style={s.loadingHint}>Complete verification in World App, then return here</Text>
            )}
          </View>
        )}

        {state === 'success' && (
          <View style={s.successWrap}>
            <View style={s.successCircle}>
              <Text style={s.successCheck}>✓</Text>
            </View>
            <Text style={s.successText}>{statusText}</Text>
          </View>
        )}

        {state === 'error' && (
          <View style={s.errorWrap}>
            <Text style={s.errorText}>{errorText}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => setState('idle')}>
              <Text style={s.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Text style={s.version}>v1.0 — ETHGlobal Cannes 2026</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  bgGlow: {
    position: 'absolute', top: '20%', left: '50%', width: 300, height: 300,
    marginLeft: -150, borderRadius: 150, backgroundColor: 'rgba(0, 255, 136, 0.03)',
  },
  gridOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.04 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#00ff88' },
  topLabel: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 60, gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00ff88' },
  topLabelText: { color: '#00ff88', fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 3 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  brand: {
    fontSize: 72, fontWeight: '900', color: '#00ff88', marginBottom: -8,
    textShadowColor: 'rgba(0, 255, 136, 0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 40,
  },
  title: { fontSize: 40, fontWeight: '800', color: '#ffffff', letterSpacing: -1 },
  tagline: { fontSize: 16, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 12, lineHeight: 24 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 28 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(0, 255, 136, 0.15)', backgroundColor: 'rgba(0, 255, 136, 0.05)',
  },
  pillText: { color: 'rgba(0, 255, 136, 0.7)', fontSize: 11, fontFamily: 'SpaceMono' },
  actions: { paddingHorizontal: 24, paddingBottom: 32 },
  verifyBtn: { backgroundColor: '#00ff88', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  verifyBtnText: { color: '#000', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  disclaimer: { color: 'rgba(255,255,255,0.25)', fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  devBtn: { alignSelf: 'center', marginTop: 20, paddingVertical: 8, paddingHorizontal: 16 },
  devBtnText: { color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: 'SpaceMono' },
  loadingWrap: { alignItems: 'center', gap: 16, paddingVertical: 20 },
  loadingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loadingHint: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  successWrap: { alignItems: 'center', gap: 16, paddingVertical: 20 },
  successCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0, 255, 136, 0.15)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#00ff88',
  },
  successCheck: { fontSize: 28, color: '#00ff88', fontWeight: 'bold' },
  successText: { color: '#00ff88', fontSize: 20, fontWeight: '700' },
  errorWrap: { alignItems: 'center', gap: 14, paddingVertical: 20 },
  errorText: { color: '#ff4444', fontSize: 13, textAlign: 'center', fontFamily: 'SpaceMono' },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  retryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  version: { color: 'rgba(255,255,255,0.1)', fontSize: 10, fontFamily: 'SpaceMono', textAlign: 'center', paddingBottom: 16 },
});
