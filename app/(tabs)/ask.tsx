import { StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { getCurrentLocation } from '@/lib/location';
import { getUser, type HoracleUser } from '@/lib/auth';
import { askQuestion, pollQuery, rateAnswer, type Query } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

type AskState = 'input' | 'searching' | 'waiting' | 'answered' | 'error' | 'expired';

export default function AskScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskState>('input');
  const [statusText, setStatusText] = useState('');
  const [currentQuery, setCurrentQuery] = useState<Query | null>(null);
  const [responderCount, setResponderCount] = useState(0);
  const [rated, setRated] = useState(false);
  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getUser().then((u) => {
      setUser(u);
      if (u) fetchRecent(u.id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const fetchRecent = async (userId: string) => {
    const { data } = await supabase
      .from('queries')
      .select('*')
      .eq('asker_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setRecentQueries(data);
  };

  const handleAsk = async () => {
    if (!question.trim()) return;

    let currentUser = user;
    if (!currentUser) {
      currentUser = await getUser();
      if (currentUser) setUser(currentUser);
    }
    if (!currentUser) {
      setStatusText('Verify with World ID first');
      setState('error');
      return;
    }

    setState('searching');
    setStatusText('Finding people nearby...');

    const loc = await getCurrentLocation();
    if (!loc) {
      setStatusText('Could not get your location');
      setState('error');
      return;
    }

    const result = await askQuestion(currentUser.id, question.trim(), loc.lat, loc.lng);

    if (result.error) {
      setStatusText(result.error);
      setState('error');
      return;
    }

    setCurrentQuery(result.query!);
    setResponderCount(result.responders || 0);
    setState('waiting');
    setStatusText(`Sent to ${result.responders} people nearby`);

    // Poll for answer every 3 seconds
    pollRef.current = setInterval(async () => {
      if (!result.query) return;
      const updated = await pollQuery(result.query.id);
      if (!updated) return;

      if (updated.status === 'answered') {
        setCurrentQuery(updated);
        setState('answered');
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (updated.status === 'expired' || new Date(updated.expires_at) < new Date()) {
        setState('expired');
        setStatusText('No one answered in time. Try again.');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 3000);
  };

  const handleRate = async (rating: 'helpful' | 'not_helpful') => {
    if (!currentQuery) return;
    await rateAnswer(currentQuery.id, rating);
    setRated(true);
  };

  const resetState = () => {
    setState('input');
    setQuestion('');
    setCurrentQuery(null);
    setStatusText('');
    setRated(false);
    if (pollRef.current) clearInterval(pollRef.current);
    if (user) fetchRecent(user.id);
  };

  return (
    <View style={s.container}>
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Input state */}
        {state === 'input' && (
          <ScrollView style={s.inputWrap} showsVerticalScrollIndicator={false}>
            <Text style={s.heading}>Ask anything</Text>
            <Text style={s.subheading}>Get answers from verified humans nearby</Text>

            <View style={s.inputCard}>
              <TextInput
                style={s.textInput}
                placeholder="Is the beach crowded right now?"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={question}
                onChangeText={setQuestion}
                multiline
                maxLength={200}
              />
              <Text style={s.charCount}>{question.length}/200</Text>
            </View>

            <View style={s.examplesWrap}>
              <Text style={s.examplesTitle}>POPULAR QUESTIONS</Text>
              {[
                'Is the beach crowded right now?',
                'How long is the wait at this restaurant?',
                'Any parking available nearby?',
                'Is the market still open?',
              ].map((ex) => (
                <TouchableOpacity key={ex} style={s.examplePill} onPress={() => setQuestion(ex)}>
                  <Text style={s.exampleText}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[s.askBtn, !question.trim() && s.askBtnDisabled]}
              onPress={handleAsk}
              activeOpacity={0.85}
              disabled={!question.trim()}
            >
              <LinearGradient
                colors={question.trim() ? ['#a78bfa', '#7c3aed'] : ['#333', '#222']}
                style={s.askBtnGradient}
              >
                <Text style={s.askBtnText}>Ask · $0.05</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Recent questions */}
            {recentQueries.length > 0 && (
              <View style={s.recentSection}>
                <Text style={s.examplesTitle}>YOUR QUESTIONS</Text>
                {recentQueries.map((q) => (
                  <View key={q.id} style={s.recentCard}>
                    <Text style={s.recentQuestion}>{q.question}</Text>
                    {q.status === 'answered' ? (
                      <View style={s.recentAnswerWrap}>
                        <Text style={s.recentAnswerLabel}>ANSWER</Text>
                        <Text style={s.recentAnswer}>{q.answer}</Text>
                      </View>
                    ) : q.status === 'open' ? (
                      <Text style={s.recentPending}>Waiting for answer...</Text>
                    ) : (
                      <Text style={s.recentExpired}>Expired — no one answered</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* Searching state */}
        {state === 'searching' && (
          <View style={s.centerWrap}>
            <ActivityIndicator size="large" color="#a78bfa" />
            <Text style={s.centerText}>{statusText}</Text>
          </View>
        )}

        {/* Waiting for answer */}
        {state === 'waiting' && (
          <View style={s.centerWrap}>
            <View style={s.waitingDots}>
              <View style={[s.waitDot, s.waitDot1]} />
              <View style={[s.waitDot, s.waitDot2]} />
              <View style={[s.waitDot, s.waitDot3]} />
            </View>
            <Text style={s.waitingTitle}>Waiting for answers...</Text>
            <Text style={s.waitingSub}>{statusText}</Text>
            <Text style={s.waitingQuestion}>"{currentQuery?.question}"</Text>
          </View>
        )}

        {/* Answer received */}
        {state === 'answered' && currentQuery && (
          <View style={s.answerWrap}>
            <View style={s.answerBadge}>
              <Text style={s.answerBadgeText}>ANSWERED</Text>
            </View>

            <Text style={s.answerQuestion}>"{currentQuery.question}"</Text>

            <View style={s.answerCard}>
              <Text style={s.answerText}>{currentQuery.answer}</Text>
              <Text style={s.answerMeta}>
                Responded in {currentQuery.response_time_ms ? `${Math.round(currentQuery.response_time_ms / 1000)}s` : '—'}
              </Text>
            </View>

            {!rated ? (
              <View style={s.rateRow}>
                <Text style={s.rateLabel}>Was this helpful?</Text>
                <View style={s.rateBtns}>
                  <TouchableOpacity style={s.rateBtn} onPress={() => handleRate('helpful')}>
                    <Text style={s.rateBtnText}>👍 Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.rateBtn} onPress={() => handleRate('not_helpful')}>
                    <Text style={s.rateBtnText}>👎 No</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={s.ratedText}>Thanks for rating!</Text>
            )}

            <TouchableOpacity style={s.newQuestionBtn} onPress={resetState}>
              <Text style={s.newQuestionText}>Ask another question</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Expired */}
        {state === 'expired' && (
          <View style={s.centerWrap}>
            <Text style={s.expiredIcon}>⏱</Text>
            <Text style={s.centerText}>{statusText}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={resetState}>
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error */}
        {state === 'error' && (
          <View style={s.centerWrap}>
            <Text style={s.errorText}>{statusText}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={resetState}>
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inner: { flex: 1, padding: 20, paddingTop: 52 },

  // Input
  inputWrap: { flex: 1 },
  heading: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  subheading: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4, marginBottom: 24 },

  inputCard: {
    borderRadius: 16, padding: 16, marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
  },
  textInput: {
    color: '#fff', fontSize: 17, minHeight: 80, textAlignVertical: 'top', lineHeight: 24,
  },
  charCount: { color: 'rgba(255,255,255,0.15)', fontSize: 11, textAlign: 'right', marginTop: 4, fontFamily: 'SpaceMono' },

  examplesWrap: { marginBottom: 20 },
  examplesTitle: { fontSize: 10, color: 'rgba(255,255,255,0.15)', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 10 },
  examplePill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  exampleText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },

  askBtn: { borderRadius: 16, overflow: 'hidden' },
  askBtnDisabled: { opacity: 0.5 },
  askBtnGradient: { paddingVertical: 18, alignItems: 'center', borderRadius: 16 },
  askBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },

  // Center states
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  centerText: { color: 'rgba(255,255,255,0.5)', fontSize: 15, textAlign: 'center' },

  // Waiting
  waitingDots: { flexDirection: 'row', gap: 8 },
  waitDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(167,139,250,0.3)' },
  waitDot1: { backgroundColor: '#a78bfa' },
  waitDot2: { backgroundColor: 'rgba(167,139,250,0.6)' },
  waitDot3: { backgroundColor: 'rgba(167,139,250,0.3)' },
  waitingTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  waitingSub: { color: 'rgba(167,139,250,0.6)', fontSize: 13 },
  waitingQuestion: { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontStyle: 'italic', marginTop: 8, textAlign: 'center', paddingHorizontal: 20 },

  // Answer
  answerWrap: { flex: 1, paddingTop: 20 },
  answerBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(167,139,250,0.15)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)',
    marginBottom: 16,
  },
  answerBadgeText: { color: '#a78bfa', fontSize: 10, fontWeight: '800', letterSpacing: 2, fontFamily: 'SpaceMono' },
  answerQuestion: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontStyle: 'italic', marginBottom: 16 },
  answerCard: {
    padding: 20, borderRadius: 16,
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
    marginBottom: 20,
  },
  answerText: { color: '#fff', fontSize: 17, lineHeight: 26 },
  answerMeta: { color: 'rgba(167,139,250,0.5)', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 12 },

  rateRow: { marginBottom: 20 },
  rateLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 10 },
  rateBtns: { flexDirection: 'row', gap: 10 },
  rateBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  rateBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ratedText: { color: 'rgba(167,139,250,0.6)', fontSize: 13, textAlign: 'center', marginBottom: 20 },

  newQuestionBtn: { alignSelf: 'center', padding: 12 },
  newQuestionText: { color: 'rgba(167,139,250,0.7)', fontSize: 14, fontWeight: '600' },

  // Expired
  expiredIcon: { fontSize: 40 },

  // Error
  errorText: { color: '#f87171', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  retryText: { color: '#fff', fontWeight: '600' },

  // Recent questions
  recentSection: { marginTop: 28 },
  recentCard: {
    padding: 14, borderRadius: 12, marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  recentQuestion: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 8 },
  recentAnswerWrap: {
    padding: 10, borderRadius: 8, backgroundColor: 'rgba(167,139,250,0.06)',
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.1)',
  },
  recentAnswerLabel: { fontSize: 9, color: 'rgba(167,139,250,0.5)', letterSpacing: 1.5, fontFamily: 'SpaceMono', marginBottom: 4 },
  recentAnswer: { color: '#fff', fontSize: 14, lineHeight: 20 },
  recentPending: { color: 'rgba(167,139,250,0.5)', fontSize: 12, fontStyle: 'italic' },
  recentExpired: { color: 'rgba(255,255,255,0.2)', fontSize: 12 },
});
