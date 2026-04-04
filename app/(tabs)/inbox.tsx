import { StyleSheet, TouchableOpacity, ScrollView, TextInput, RefreshControl } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
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
  const [tick, setTick] = useState(0);

  useEffect(() => { getUser().then(setUser); }, []);
  useEffect(() => {
    if (!user) return;
    fetchQueries();
    const interval = setInterval(fetchQueries, 4000);
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(interval); clearInterval(tickInterval); };
  }, [user]);

  const fetchQueries = async () => {
    const { data } = await supabase.from('queries').select('*').eq('status', 'open').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(20);
    if (data) setQueries(data);
  };

  const onRefresh = async () => { setRefreshing(true); await fetchQueries(); setRefreshing(false); };

  const handleAnswer = async (queryId: string) => {
    if (!answerText.trim() || !user) return;
    const result = await answerQuery(queryId, user.id, answerText.trim());
    if (result.success) { setAnswering(null); setAnswerText(''); setSubmitted(prev => new Set(prev).add(queryId)); fetchQueries(); }
  };

  const timeLeft = (expiresAt: string) => {
    const secs = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
    if (secs > 60) return `${Math.floor(secs / 60)}m`;
    return `${secs}s`;
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.heading}>Inbox</Text>
        {queries.length > 0 && <View style={s.countBadge}><Text style={s.countText}>{queries.length}</Text></View>}
      </View>
      <Text style={s.subheading}>Questions from people nearby</Text>

      <ScrollView style={s.list} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A0A0AB" />}>
        {queries.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>No questions yet</Text>
            <Text style={s.emptyText}>Start earning to be found by people nearby</Text>
          </View>
        ) : queries.map((q) => (
          <View key={q.id} style={s.card}>
            <View style={s.cardTop}>
              <Text style={s.budget}>${q.budget_usdc?.toFixed(2)}</Text>
              <Text style={s.timer}>{timeLeft(q.expires_at)} left</Text>
            </View>
            <Text style={s.question}>{q.question}</Text>
            {submitted.has(q.id) ? (
              <View style={s.doneBadge}><Text style={s.doneText}>Answered · ${q.budget_usdc?.toFixed(2)} earned</Text></View>
            ) : answering === q.id ? (
              <View style={s.inputWrap}>
                <TextInput style={s.input} placeholder="Type your answer..." placeholderTextColor="#C8C8D0" value={answerText} onChangeText={setAnswerText} multiline autoFocus />
                <View style={s.btnRow}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => { setAnswering(null); setAnswerText(''); }}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.sendBtn, !answerText.trim() && { opacity: 0.4 }]} onPress={() => handleAnswer(q.id)} disabled={!answerText.trim()}>
                    <Text style={s.sendText}>Send · ${q.budget_usdc?.toFixed(2)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={s.answerBtn} onPress={() => { setAnswering(q.id); setAnswerText(''); }}>
                <Text style={s.answerBtnText}>Answer this question</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 52 },
  heading: { fontSize: 26, fontWeight: '700', color: '#1A1A1E' },
  countBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#7C5CFC', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  subheading: { color: '#A0A0AB', fontSize: 13, paddingHorizontal: 20, marginTop: 4, marginBottom: 16 },
  list: { flex: 1, paddingHorizontal: 20 },

  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { color: '#6B6B76', fontSize: 17, fontWeight: '600' },
  emptyText: { color: '#A0A0AB', fontSize: 13 },

  card: { padding: 16, borderRadius: 14, marginBottom: 12, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  budget: { color: '#1A1A1E', fontSize: 14, fontWeight: '700' },
  timer: { color: '#A0A0AB', fontSize: 12, fontFamily: 'SpaceMono' },
  question: { color: '#1A1A1E', fontSize: 17, fontWeight: '500', lineHeight: 24, marginBottom: 14 },

  doneBadge: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#F0FAF3' },
  doneText: { color: '#34C759', fontSize: 13, fontWeight: '600' },

  answerBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#7C5CFC' },
  answerBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  inputWrap: { gap: 10 },
  input: { color: '#1A1A1E', fontSize: 15, padding: 14, borderRadius: 12, minHeight: 70, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8EC', textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#EEEDF5' },
  cancelText: { color: '#6B6B76', fontSize: 14, fontWeight: '600' },
  sendBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#7C5CFC' },
  sendText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
