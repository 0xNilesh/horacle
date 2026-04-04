import { StyleSheet, TouchableOpacity, ScrollView, TextInput, RefreshControl } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { getUser, type HoracleUser } from '@/lib/auth';
import { answerQuery } from '@/lib/queries';

export default function InboxScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [queries, setQueries] = useState<any[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    getUser().then((u) => {
      setUser(u);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchQueries();
    const interval = setInterval(fetchQueries, 4000);
    return () => clearInterval(interval);
  }, [user]);

  const fetchQueries = async () => {
    const { data } = await supabase
      .from('queries')
      .select('*')
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setQueries(data);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchQueries();
    setRefreshing(false);
  };

  const handleAnswer = async (queryId: string, budget: number) => {
    if (!answerText.trim() || !user) return;
    const result = await answerQuery(queryId, user.id, answerText.trim());
    if (result.success) {
      setAnswering(null);
      setAnswerText('');
      setSubmitted((prev) => new Set(prev).add(queryId));
      fetchQueries();
    }
  };

  const timeLeft = (expiresAt: string) => {
    const secs = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
    if (secs > 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${secs}s`;
  };

  return (
    <View style={s.container}>
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <View style={s.header}>
        <Text style={s.heading}>Inbox</Text>
        {queries.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countText}>{queries.length}</Text>
          </View>
        )}
      </View>
      <Text style={s.subheading}>Questions from people nearby</Text>

      <ScrollView
        style={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#a78bfa" />}
      >
        {queries.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>📭</Text>
            <Text style={s.emptyTitle}>No questions yet</Text>
            <Text style={s.emptyText}>
              When someone nearby asks a question,{'\n'}it'll appear here. Start earning to be found!
            </Text>
          </View>
        ) : (
          queries.map((q) => (
            <View key={q.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={s.budgetBadge}>
                  <Text style={s.budgetText}>💰 ${q.budget_usdc?.toFixed(2)}</Text>
                </View>
                <Text style={s.timer}>⏱ {timeLeft(q.expires_at)}</Text>
              </View>

              <Text style={s.question}>{q.question}</Text>

              {submitted.has(q.id) ? (
                <View style={s.doneBadge}>
                  <Text style={s.doneText}>✓ Answered · ${q.budget_usdc?.toFixed(2)} earned</Text>
                </View>
              ) : answering === q.id ? (
                <View style={s.inputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="Type your answer..."
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    value={answerText}
                    onChangeText={setAnswerText}
                    multiline
                    autoFocus
                  />
                  <View style={s.btnRow}>
                    <TouchableOpacity
                      style={s.cancelBtn}
                      onPress={() => { setAnswering(null); setAnswerText(''); }}
                    >
                      <Text style={s.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.sendBtn, !answerText.trim() && { opacity: 0.4 }]}
                      onPress={() => handleAnswer(q.id, q.budget_usdc)}
                      disabled={!answerText.trim()}
                    >
                      <LinearGradient
                        colors={['#a78bfa', '#7c3aed']}
                        style={s.sendGradient}
                      >
                        <Text style={s.sendText}>Send · Earn ${q.budget_usdc?.toFixed(2)}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.answerBtn}
                  onPress={() => { setAnswering(q.id); setAnswerText(''); }}
                >
                  <Text style={s.answerText}>Answer this question</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 52,
  },
  heading: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  countBadge: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#7c3aed',
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  subheading: { color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingHorizontal: 20, marginTop: 4, marginBottom: 16 },

  list: { flex: 1, paddingHorizontal: 20 },

  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 18, fontWeight: '700' },
  emptyText: { color: 'rgba(255,255,255,0.2)', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // Card
  card: {
    padding: 18, borderRadius: 16, marginBottom: 12,
    backgroundColor: 'rgba(167,139,250,0.05)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  budgetBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  budgetText: { color: '#a78bfa', fontSize: 13, fontWeight: '700' },
  timer: { color: 'rgba(255,255,255,0.25)', fontSize: 11, fontFamily: 'SpaceMono' },

  question: { color: '#fff', fontSize: 18, fontWeight: '500', lineHeight: 26, marginBottom: 16 },

  // Done
  doneBadge: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  doneText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },

  // Answer button
  answerBtn: {
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(167,139,250,0.12)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.25)',
  },
  answerText: { color: '#a78bfa', fontSize: 15, fontWeight: '700' },

  // Input
  inputWrap: { gap: 10 },
  input: {
    color: '#fff', fontSize: 16, padding: 14, borderRadius: 12, minHeight: 80,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
    textAlignVertical: 'top', lineHeight: 22,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '600' },
  sendBtn: { flex: 2, borderRadius: 10, overflow: 'hidden' },
  sendGradient: { paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  sendText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
