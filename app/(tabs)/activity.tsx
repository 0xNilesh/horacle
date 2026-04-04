import { StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getUser, type HoracleUser } from '@/lib/auth';

type Tab = 'asked' | 'answered';

export default function ActivityScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [tab, setTab] = useState<Tab>('asked');
  const [myQuestions, setMyQuestions] = useState<any[]>([]);
  const [myAnswers, setMyAnswers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    getUser().then((u) => { setUser(u); if (u) fetchAll(u.id); });
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(tickInterval);
  }, []);

  const [locationNames, setLocationNames] = useState<Record<string, string>>({});

  const fetchAll = async (userId: string) => {
    setLoading(true);
    await supabase.rpc('expire_stale');
    const { data: asked } = await supabase.from('queries').select('*').eq('asker_id', userId).order('created_at', { ascending: false }).limit(20);
    const { data: answered } = await supabase.from('queries').select('*').eq('responder_id', userId).order('created_at', { ascending: false }).limit(20);

    // Reverse geocode query locations
    const allQueries = [...(asked || []), ...(answered || [])];
    const { reverseGeocode } = await import('@/lib/geocode');
    for (const q of allQueries.slice(0, 5)) {
      if (q.location && !locationNames[q.id]) {
        try {
          // Extract lat/lng from PostGIS — stored as geography, need to query
          const { data: coords } = await supabase.rpc('get_query_coords', { p_query_id: q.id });
          if (coords) {
            const name = await reverseGeocode(coords.lat, coords.lng);
            setLocationNames(prev => ({ ...prev, [q.id]: name }));
          }
        } catch {}
      }
    }
    if (asked) setMyQuestions(asked);
    if (answered) setMyAnswers(answered);
    setLoading(false);
  };

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now'; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`;
  };

  const items = tab === 'asked' ? myQuestions : myAnswers;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.heading}>Activity</Text>
        <TouchableOpacity onPress={() => { if (user) fetchAll(user.id); }}><Text style={s.refreshBtn}>Refresh</Text></TouchableOpacity>
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tab, tab === 'asked' && s.tabActive]} onPress={() => setTab('asked')}>
          <Text style={[s.tabText, tab === 'asked' && s.tabTextActive]}>Questions ({myQuestions.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'answered' && s.tabActive]} onPress={() => setTab('answered')}>
          <Text style={[s.tabText, tab === 'answered' && s.tabTextActive]}>Answers ({myAnswers.length})</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {loading && <Text style={s.emptyText}>Loading...</Text>}
        {!loading && items.length === 0 && (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>{tab === 'asked' ? 'No questions yet' : 'No answers yet'}</Text>
            <Text style={s.emptyText}>{tab === 'asked' ? 'Go to Ask tab to ask something' : 'Start earning to answer questions'}</Text>
          </View>
        )}
        {items.map((q) => {
          const isExpired = q.status === 'expired' || (q.status === 'open' && new Date(q.expires_at) < new Date());
          const displayStatus = q.status === 'answered' ? 'answered' : isExpired ? 'expired' : q.status;
          return (
            <View key={q.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={[s.statusBadge, displayStatus === 'answered' && s.statusAnswered, displayStatus === 'open' && s.statusOpen, displayStatus === 'expired' && s.statusExpired]}>
                  <Text style={[s.statusText, displayStatus === 'answered' && s.statusTextAnswered, displayStatus === 'open' && s.statusTextOpen]}>
                    {displayStatus === 'answered' ? 'Answered' : displayStatus === 'open' ? 'Waiting' : 'Expired'}
                  </Text>
                </View>
                <Text style={s.timeAgo}>
                  {displayStatus === 'open' ? `${Math.max(0, Math.floor((new Date(q.expires_at).getTime() - Date.now()) / 60000))}m left` : timeAgo(q.created_at)}
                </Text>
              </View>
              <Text style={s.questionText}>{q.question}</Text>
              {locationNames[q.id] && <Text style={s.locationText}>{locationNames[q.id]}</Text>}
              {q.answer && (
                <View style={s.answerBox}>
                  <Text style={s.answerLabel}>{tab === 'asked' ? 'Answer' : 'Your answer'}</Text>
                  <Text style={s.answerText}>{q.answer}</Text>
                </View>
              )}
              <View style={s.metaRow}>
                {q.response_time_ms && <Text style={s.meta}>{Math.round(q.response_time_ms / 1000)}s</Text>}
                {q.budget_usdc && <Text style={s.meta}>${q.budget_usdc.toFixed(2)}</Text>}
                {q.rating && <Text style={s.meta}>{q.rating === 'helpful' ? 'Helpful' : 'Not helpful'}</Text>}
              </View>
            </View>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 12 },
  heading: { fontSize: 26, fontWeight: '700', color: '#1A1A1E' },
  refreshBtn: { color: '#A0A0AB', fontSize: 14 },

  tabRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, backgroundColor: '#F5F5F7', borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#FFFFFF', shadowColor: '#7C5CFC', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabText: { color: '#A5A4B4', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#7C5CFC' },

  list: { flex: 1, paddingHorizontal: 20 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: '#6B6B76', fontSize: 17, fontWeight: '600' },
  emptyText: { color: '#A0A0AB', fontSize: 13 },

  card: { padding: 14, borderRadius: 12, marginBottom: 10, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#EEEDF5' },
  statusAnswered: { backgroundColor: '#F0FAF3' },
  statusOpen: { backgroundColor: '#FFF8E1' },
  statusExpired: {},
  statusText: { fontSize: 11, fontWeight: '600', color: '#A0A0AB' },
  statusTextAnswered: { color: '#34C759' },
  statusTextOpen: { color: '#FF9500' },
  timeAgo: { fontSize: 11, color: '#A0A0AB', fontFamily: 'SpaceMono' },

  questionText: { color: '#1A1A1E', fontSize: 15, fontWeight: '500', lineHeight: 22, marginBottom: 4 },
  locationText: { color: '#A5A4B4', fontSize: 12, marginBottom: 8 },
  answerBox: { padding: 10, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8EC', marginBottom: 8 },
  answerLabel: { fontSize: 10, color: '#A0A0AB', letterSpacing: 1, marginBottom: 4 },
  answerText: { color: '#1A1A1E', fontSize: 14, lineHeight: 20 },

  metaRow: { flexDirection: 'row', gap: 12 },
  meta: { color: '#A0A0AB', fontSize: 11, fontFamily: 'SpaceMono' },
});
