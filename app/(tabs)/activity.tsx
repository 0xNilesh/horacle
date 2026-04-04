import { StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { getUser, type HoracleUser } from '@/lib/auth';

type Tab = 'asked' | 'answered';

export default function ActivityScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [tab, setTab] = useState<Tab>('asked');
  const [myQuestions, setMyQuestions] = useState<any[]>([]);
  const [myAnswers, setMyAnswers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUser().then((u) => {
      setUser(u);
      if (u) fetchAll(u.id);
    });
  }, []);

  const fetchAll = async (userId: string) => {
    setLoading(true);

    // My questions (as asker)
    const { data: asked } = await supabase
      .from('queries')
      .select('*')
      .eq('asker_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    // My answers (as responder)
    const { data: answered } = await supabase
      .from('queries')
      .select('*')
      .eq('responder_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (asked) setMyQuestions(asked);
    if (answered) setMyAnswers(answered);
    setLoading(false);
  };

  const refresh = () => { if (user) fetchAll(user.id); };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const items = tab === 'asked' ? myQuestions : myAnswers;

  return (
    <View style={s.container}>
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <View style={s.header}>
        <Text style={s.heading}>Activity</Text>
        <TouchableOpacity onPress={refresh}>
          <Text style={s.refreshBtn}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tab, tab === 'asked' && s.tabActive]}
          onPress={() => setTab('asked')}
        >
          <Text style={[s.tabText, tab === 'asked' && s.tabTextActive]}>
            My Questions ({myQuestions.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'answered' && s.tabActive]}
          onPress={() => setTab('answered')}
        >
          <Text style={[s.tabText, tab === 'answered' && s.tabTextActive]}>
            My Answers ({myAnswers.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {loading && (
          <Text style={s.emptyText}>Loading...</Text>
        )}

        {!loading && items.length === 0 && (
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>{tab === 'asked' ? '❓' : '💬'}</Text>
            <Text style={s.emptyText}>
              {tab === 'asked'
                ? 'No questions yet. Go to the Ask tab to ask something!'
                : 'No answers yet. Start earning to answer nearby questions!'}
            </Text>
          </View>
        )}

        {items.map((q) => (
          <View key={q.id} style={s.card}>
            {/* Status badge */}
            <View style={s.cardTop}>
              <View style={[
                s.statusBadge,
                q.status === 'answered' && s.statusAnswered,
                q.status === 'open' && s.statusOpen,
                q.status === 'expired' && s.statusExpired,
              ]}>
                <Text style={[
                  s.statusText,
                  q.status === 'answered' && s.statusTextAnswered,
                  q.status === 'open' && s.statusTextOpen,
                ]}>
                  {q.status === 'answered' ? '✓ ANSWERED' : q.status === 'open' ? '⏳ WAITING' : '✕ EXPIRED'}
                </Text>
              </View>
              <Text style={s.timeAgo}>{timeAgo(q.created_at)}</Text>
            </View>

            {/* Question */}
            <Text style={s.questionText}>{q.question}</Text>

            {/* Answer (if exists) */}
            {q.answer && (
              <View style={s.answerBox}>
                <Text style={s.answerLabel}>
                  {tab === 'asked' ? 'ANSWER' : 'YOUR ANSWER'}
                </Text>
                <Text style={s.answerText}>{q.answer}</Text>
              </View>
            )}

            {/* Stats row */}
            <View style={s.statsRow}>
              {q.response_time_ms && (
                <Text style={s.statItem}>⚡ {Math.round(q.response_time_ms / 1000)}s</Text>
              )}
              {q.budget_usdc && (
                <Text style={s.statItem}>💰 ${q.budget_usdc.toFixed(2)}</Text>
              )}
              {q.rating && (
                <Text style={s.statItem}>{q.rating === 'helpful' ? '👍' : '👎'} {q.rating}</Text>
              )}
            </View>
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 52, paddingBottom: 12,
  },
  heading: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  refreshBtn: { color: 'rgba(167,139,250,0.6)', fontSize: 14 },

  // Tabs
  tabRow: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 3,
  },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(167,139,250,0.15)',
  },
  tabText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#a78bfa' },

  // List
  list: { flex: 1, paddingHorizontal: 20 },

  // Empty
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  // Card
  card: {
    padding: 16, borderRadius: 14, marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  statusBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  statusAnswered: { backgroundColor: 'rgba(167,139,250,0.1)' },
  statusOpen: { backgroundColor: 'rgba(250,200,50,0.1)' },
  statusExpired: { backgroundColor: 'rgba(255,255,255,0.03)' },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 1, fontFamily: 'SpaceMono', color: 'rgba(255,255,255,0.3)' },
  statusTextAnswered: { color: '#a78bfa' },
  statusTextOpen: { color: 'rgba(250,200,50,0.7)' },
  timeAgo: { fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'SpaceMono' },

  questionText: { color: '#fff', fontSize: 16, fontWeight: '500', lineHeight: 23, marginBottom: 10 },

  answerBox: {
    padding: 12, borderRadius: 10, marginBottom: 10,
    backgroundColor: 'rgba(167,139,250,0.05)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.1)',
  },
  answerLabel: { fontSize: 9, color: 'rgba(167,139,250,0.5)', letterSpacing: 1.5, fontFamily: 'SpaceMono', marginBottom: 4 },
  answerText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 21 },

  statsRow: { flexDirection: 'row', gap: 14 },
  statItem: { color: 'rgba(255,255,255,0.25)', fontSize: 11, fontFamily: 'SpaceMono' },
});
