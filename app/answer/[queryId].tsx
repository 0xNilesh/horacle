import { StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { getUser } from '@/lib/auth';
import { pollQuery, answerQuery } from '@/lib/queries';
import { getCurrentLocation } from '@/lib/location';

type AnswerState = 'loading' | 'ready' | 'submitting' | 'submitted' | 'taken' | 'error';

export default function AnswerScreen() {
  const { queryId } = useLocalSearchParams<{ queryId: string }>();
  const [state, setState] = useState<AnswerState>('loading');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [distance, setDistance] = useState<number | null>(null);

  useEffect(() => {
    loadQuery();
  }, []);

  const loadQuery = async () => {
    if (!queryId) { setState('error'); setError('No query ID'); return; }

    const query = await pollQuery(queryId);
    if (!query) { setState('error'); setError('Query not found'); return; }
    if (query.status !== 'open') { setState('taken'); return; }

    setQuestion(query.question);

    // Check distance from query location
    const loc = await getCurrentLocation();
    if (loc) {
      // Simple distance calc (approximate)
      const dLat = (loc.lat - 43.55) * 111000; // placeholder — query location not exposed yet
      const dLng = (loc.lng - 7.02) * 111000 * Math.cos(loc.lat * Math.PI / 180);
      setDistance(Math.round(Math.sqrt(dLat * dLat + dLng * dLng)));
    }

    setState('ready');
  };

  const handleSubmit = async () => {
    if (!answer.trim() || !queryId) return;

    const user = await getUser();
    if (!user) { setError('Not logged in'); setState('error'); return; }

    setState('submitting');

    const result = await answerQuery(queryId, user.id, answer.trim());

    if (!result.success) {
      if (result.error?.includes('already answered')) {
        setState('taken');
      } else {
        setError(result.error || 'Failed to submit');
        setState('error');
      }
      return;
    }

    setState('submitted');
  };

  return (
    <View style={s.container}>

      <View style={s.inner}>
        {/* Header */}
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>

        {state === 'loading' && (
          <View style={s.centerWrap}>
            <ActivityIndicator size="large" color="#7C5CFC" />
            <Text style={s.centerText}>Loading question...</Text>
          </View>
        )}

        {state === 'ready' && (
          <View style={s.contentWrap}>
            <View style={s.earningBadge}>
              <Text style={s.earningText}>💰 Earn $0.05</Text>
            </View>

            <Text style={s.questionLabel}>SOMEONE NEARBY IS ASKING</Text>
            <Text style={s.questionText}>"{question}"</Text>

            {distance !== null && (
              <Text style={s.distanceText}>📍 You're approximately nearby</Text>
            )}

            <View style={s.answerCard}>
              <TextInput
                style={s.answerInput}
                placeholder="Type your answer..."
                placeholderTextColor="#C8C8D0"
                value={answer}
                onChangeText={setAnswer}
                multiline
                maxLength={500}
                autoFocus
              />
              <Text style={s.charCount}>{answer.length}/500</Text>
            </View>

            <TouchableOpacity
              style={[s.submitBtn, !answer.trim() && s.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!answer.trim()}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={answer.trim() ? ['#7C5CFC', '#7C5CFC'] : ['#333', '#222']}
                style={s.submitGradient}
              >
                <Text style={s.submitText}>Send Answer · Earn $0.05</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {state === 'submitting' && (
          <View style={s.centerWrap}>
            <ActivityIndicator size="large" color="#7C5CFC" />
            <Text style={s.centerText}>Submitting...</Text>
          </View>
        )}

        {state === 'submitted' && (
          <View style={s.centerWrap}>
            <View style={s.successCircle}>
              <Text style={s.successIcon}>💰</Text>
            </View>
            <Text style={s.successTitle}>$0.05 earned!</Text>
            <Text style={s.successSub}>Your answer has been sent</Text>
            <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={s.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'taken' && (
          <View style={s.centerWrap}>
            <Text style={s.takenIcon}>⚡</Text>
            <Text style={s.centerText}>Someone already answered this one</Text>
            <Text style={s.takenSub}>Be faster next time!</Text>
            <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={s.doneText}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'error' && (
          <View style={s.centerWrap}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={s.doneText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  inner: { flex: 1, padding: 20, paddingTop: 52 },

  backBtn: { marginBottom: 20 },
  backText: { color: '#A5A4B4', fontSize: 15 },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  centerText: { color: '#6E6D7A', fontSize: 16, textAlign: 'center' },

  contentWrap: { flex: 1 },

  earningBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10,
    backgroundColor: 'rgba(124,92,252,0.1)', borderWidth: 1, borderColor: 'rgba(124,92,252,0.2)',
    marginBottom: 20,
  },
  earningText: { color: '#7C5CFC', fontSize: 14, fontWeight: '700' },

  questionLabel: { fontSize: 10, color: '#C8C8D0', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 8 },
  questionText: { fontSize: 22, color: '#1A1A2E', fontWeight: '300', lineHeight: 32, marginBottom: 16 },
  distanceText: { color: 'rgba(124,92,252,0.5)', fontSize: 12, marginBottom: 20 },

  answerCard: {
    borderRadius: 16, padding: 16, marginBottom: 20,
    backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: 'rgba(124,92,252,0.15)',
  },
  answerInput: { color: '#1A1A2E', fontSize: 16, minHeight: 100, textAlignVertical: 'top', lineHeight: 24 },
  charCount: { color: '#EEEDF5', fontSize: 11, textAlign: 'right', marginTop: 4, fontFamily: 'SpaceMono' },

  submitBtn: { borderRadius: 16, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.5 },
  submitGradient: { paddingVertical: 18, alignItems: 'center', borderRadius: 16 },
  submitText: { color: '#1A1A2E', fontSize: 17, fontWeight: '800' },

  successCircle: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,92,252,0.1)', borderWidth: 2, borderColor: 'rgba(124,92,252,0.3)',
  },
  successIcon: { fontSize: 36 },
  successTitle: { color: '#7C5CFC', fontSize: 24, fontWeight: '800' },
  successSub: { color: '#A5A4B4', fontSize: 14 },

  takenIcon: { fontSize: 40 },
  takenSub: { color: '#A5A4B4', fontSize: 13 },

  errorText: { color: '#f87171', fontSize: 14, textAlign: 'center' },

  doneBtn: {
    marginTop: 10, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    borderWidth: 1, borderColor: '#EEEDF5',
  },
  doneText: { color: '#1A1A2E', fontWeight: '600' },
});
