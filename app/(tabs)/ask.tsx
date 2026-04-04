import { StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { getCurrentLocation } from '@/lib/location';
import { getUser, type HoracleUser } from '@/lib/auth';
import { askQuestion, pollQuery, rateAnswer, type Query } from '@/lib/queries';
import { searchPlace, reverseGeocode, type GeoResult } from '@/lib/geocode';
import { supabase } from '@/lib/supabase';
import { hasRealWallet } from '@/lib/wallet';
import { Alert } from 'react-native';

type AskState = 'input' | 'searching' | 'waiting' | 'answered' | 'error' | 'expired';

export default function AskScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskState>('input');
  const [statusText, setStatusText] = useState('');
  const [currentQuery, setCurrentQuery] = useState<Query | null>(null);
  const [rated, setRated] = useState(false);
  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Location state
  const [locationMode, setLocationMode] = useState<'current' | 'search'>('current');
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<GeoResult[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<GeoResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [myPlaceName, setMyPlaceName] = useState('');
  const [myNearbyCount, setMyNearbyCount] = useState(0);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get user's location + reverse geocode + nearby count
  useEffect(() => {
    (async () => {
      try {
        const loc = await getCurrentLocation();
        if (loc) {
          setMyLocation(loc);
          const name = await reverseGeocode(loc.lat, loc.lng);
          setMyPlaceName(name);
          // Count nearby live people
          const { data } = await supabase.rpc('find_live_responders', {
            p_lng: loc.lng, p_lat: loc.lat, p_radius_m: 1000,
          });
          setMyNearbyCount(data?.length || 0);
        }
      } catch (err) {
        console.error('[Ask] Location error:', err);
      }
    })();
  }, []);

  useEffect(() => {
    getUser().then((u) => {
      setUser(u);
      if (u) fetchRecent(u.id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const fetchRecent = async (userId: string) => {
    // Expire stale queries first
    await supabase.rpc('expire_stale');

    const { data } = await supabase
      .from('queries')
      .select('*')
      .eq('asker_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setRecentQueries(data);
  };

  // Auto-search as user types (debounced 500ms)
  const handleSearchTextChange = (text: string) => {
    setSearchText(text);
    setSelectedLocation(null);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      const results = await searchPlace(text.trim(), myLocation?.lat, myLocation?.lng);
      setSearchResults(results);
      setSearching(false);
    }, 500);
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

    let lat: number, lng: number;

    if (locationMode === 'search' && selectedLocation) {
      lat = selectedLocation.lat;
      lng = selectedLocation.lng;
    } else {
      const loc = await getCurrentLocation();
      if (!loc) {
        setStatusText('Could not get your location');
        setState('error');
        return;
      }
      lat = loc.lat;
      lng = loc.lng;
    }

    // Try x402 paid flow (signs payment, falls back to free if settlement fails)
    let queryId: string | undefined;
    let responders = 0;
    let paid = false;

    try {
      const { askWithPayment } = await import('@/lib/payment');
      const result = await askWithPayment(currentUser.id, question.trim(), lat, lng);
      queryId = result.queryId;
      responders = result.responders || 0;
      paid = result.paid || false;
    } catch (err: any) {
      console.log('[Ask] Payment flow FAILED:', err?.message || err);
      console.log('[Ask] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
    }

    // Fallback: create question directly via Supabase if backend failed
    if (!queryId) {
      try {
        const { askQuestion } = await import('@/lib/queries');
        const freeResult = await askQuestion(currentUser.id, question.trim(), lat, lng);
        queryId = freeResult.query?.id;
        responders = freeResult.responders || 0;
      } catch (err) {
        console.log('[Ask] Free ask also failed:', err);
      }
    }

    if (!queryId) {
      setStatusText('Could not create question. Check your connection.');
      setState('error');
      return;
    }

    setCurrentQuery({ id: queryId, question: question.trim(), status: 'open', budget_usdc: 0.05, answer: null, responder_id: null, response_time_ms: null, rating: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 60000).toISOString(), asker_id: currentUser.id } as any);
    setState('waiting');
    if (responders > 0) {
      setStatusText(`${paid ? 'Paid · ' : ''}Sent to ${responders} people nearby`);
    } else {
      setStatusText('Posted — anyone who goes live near there will see it');
    }

    pollRef.current = setInterval(async () => {
      if (!queryId) return;
      const updated = await pollQuery(queryId);
      if (!updated) return;
      if (updated.status === 'answered') {
        setCurrentQuery(updated);
        setState('answered');
        if (pollRef.current) clearInterval(pollRef.current);

        // Payment is handled by the backend pool wallet via daily batch settlement
        // The asker already paid via x402 when asking
      } else if (updated.status === 'expired' || new Date(updated.expires_at) < new Date()) {
        setState('expired');
        setStatusText('No one answered in time.');
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
    setSelectedLocation(null);
    setSearchText('');
    setSearchResults([]);
    setLocationMode('current');
    if (pollRef.current) clearInterval(pollRef.current);
    if (user) fetchRecent(user.id);
  };

  return (
    <View style={s.container}>

      {/* Input state */}
      {state === 'input' && (
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={s.heading}>Ask anything</Text>
          <Text style={s.subheading}>Get answers from verified humans at any location</Text>

          {/* Location picker */}
          <View style={s.locationSection}>
            <Text style={s.label}>📍 LOCATION</Text>
            <View style={s.locationToggle}>
              <TouchableOpacity
                style={[s.toggleBtn, locationMode === 'current' && s.toggleActive]}
                onPress={() => { setLocationMode('current'); setSelectedLocation(null); setSearchResults([]); }}
              >
                <Text style={[s.toggleText, locationMode === 'current' && s.toggleTextActive]}>My Location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toggleBtn, locationMode === 'search' && s.toggleActive]}
                onPress={() => setLocationMode('search')}
              >
                <Text style={[s.toggleText, locationMode === 'search' && s.toggleTextActive]}>Search Place</Text>
              </TouchableOpacity>
            </View>

            {/* Show current location info */}
            {locationMode === 'current' && myLocation && (
              <View style={s.currentLocInfo}>
                <Text style={s.currentLocName}>📍 {myPlaceName || 'Getting location...'}</Text>
                <Text style={s.currentLocCoords}>{myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}</Text>
                <View style={s.nearbyRow}>
                  {myNearbyCount > 0 ? (
                    <>
                      <View style={s.nearbyDots}>
                        {Array.from({ length: Math.min(myNearbyCount, 5) }).map((_, i) => (
                          <View key={i} style={s.nearbyDot} />
                        ))}
                      </View>
                      <Text style={s.nearbyText}>{myNearbyCount} {myNearbyCount === 1 ? 'person' : 'people'} nearby</Text>
                    </>
                  ) : (
                    <Text style={s.nearbyNone}>No one live nearby right now</Text>
                  )}
                </View>
              </View>
            )}

            {/* Search place */}
            {locationMode === 'search' && (
              <View style={s.searchWrap}>
                <TextInput
                  style={s.searchInput}
                  placeholder="Type a place name..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={searchText}
                  onChangeText={handleSearchTextChange}
                  autoFocus
                />
                {searching && <Text style={s.searchingText}>Searching...</Text>}

                {selectedLocation && (
                  <SelectedPlaceCard location={selectedLocation} onClear={() => { setSelectedLocation(null); setSearchText(''); }} />
                )}

                {searchResults.length > 0 && !selectedLocation && (
                  <View style={s.resultsWrap}>
                    {searchResults.map((r, i) => (
                      <TouchableOpacity
                        key={i}
                        style={s.resultItem}
                        onPress={() => { setSelectedLocation(r); setSearchResults([]); setSearchText(r.name); }}
                      >
                        <Text style={s.resultText}>📍 {r.name}</Text>
                        <Text style={s.resultCoords}>{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Question input */}
          <View style={s.questionSection}>
            <Text style={s.label}>❓ QUESTION</Text>
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
          </View>

          {/* Quick examples */}
          <View style={s.examplesWrap}>
            <Text style={s.label}>POPULAR QUESTIONS</Text>
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

          {/* Ask button */}
          <TouchableOpacity
            style={[s.askBtn, (!question.trim() || (locationMode === 'search' && !selectedLocation)) && s.askBtnDisabled]}
            onPress={handleAsk}
            activeOpacity={0.85}
            disabled={!question.trim() || (locationMode === 'search' && !selectedLocation)}
          >
            <View style={s.askBtnGradient}>
              <Text style={s.askBtnText}>Ask · $0.05</Text>
            </View>
          </TouchableOpacity>

          {/* Recent questions */}
          {recentQueries.length > 0 && (
            <View style={s.recentSection}>
              <Text style={s.label}>YOUR QUESTIONS</Text>
              {recentQueries.map((q) => {
                const isExpired = q.status === 'open' && new Date(q.expires_at) < new Date();
                const timeLeft = q.status === 'open' && !isExpired
                  ? Math.max(0, Math.round((new Date(q.expires_at).getTime() - Date.now()) / 60000))
                  : 0;

                return (
                <View key={q.id} style={s.recentCard}>
                  <Text style={s.recentQuestion}>{q.question}</Text>
                  {q.status === 'answered' ? (
                    <View style={s.recentAnswerWrap}>
                      <Text style={s.recentAnswerLabel}>ANSWER</Text>
                      <Text style={s.recentAnswer}>{q.answer}</Text>
                    </View>
                  ) : isExpired || q.status === 'expired' ? (
                    <Text style={s.recentExpired}>✕ Expired — no one answered</Text>
                  ) : q.status === 'open' ? (
                    <Text style={s.recentPending}>⏳ Waiting... {timeLeft}m left</Text>
                  ) : (
                    <Text style={s.recentExpired}>✕ Expired</Text>
                  )}
                </View>
              );
              })}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Searching */}
      {state === 'searching' && (
        <View style={s.centerWrap}>
          <ActivityIndicator size="large" color="#a78bfa" />
          <Text style={s.centerText}>{statusText}</Text>
        </View>
      )}

      {/* Waiting */}
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
          <TouchableOpacity style={s.backBtn} onPress={resetState}>
            <Text style={s.backBtnText}>Ask another question</Text>
          </TouchableOpacity>
          <Text style={s.waitingHint}>You'll see the answer in Activity tab</Text>
        </View>
      )}

      {/* Answered */}
      {state === 'answered' && currentQuery && (
        <ScrollView style={s.scroll}>
          <View style={s.answerBadge}>
            <Text style={s.answerBadgeText}>✓ ANSWERED</Text>
          </View>
          <Text style={s.answerQuestion}>"{currentQuery.question}"</Text>
          <View style={s.answerCard}>
            <Text style={s.answerText}>{currentQuery.answer}</Text>
            <Text style={s.answerMeta}>
              ⚡ {currentQuery.response_time_ms ? `${Math.round(currentQuery.response_time_ms / 1000)}s` : '—'}
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
          <TouchableOpacity style={s.newBtn} onPress={resetState}>
            <Text style={s.newBtnText}>Ask another question</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Expired */}
      {state === 'expired' && (
        <View style={s.centerWrap}>
          <Text style={{ fontSize: 40 }}>⏱</Text>
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
    </View>
  );
}

// Shows selected place with nearby people count
function SelectedPlaceCard({ location, onClear }: { location: GeoResult; onClear: () => void }) {
  const [nearbyCount, setNearbyCount] = useState(0);

  useEffect(() => {
    supabase.rpc('find_live_responders', {
      p_lng: location.lng,
      p_lat: location.lat,
      p_radius_m: 1000,
    }).then(({ data }) => {
      setNearbyCount(data?.length || 0);
    });
  }, [location]);

  return (
    <TouchableOpacity style={s.selectedPlace} onPress={onClear}>
      <Text style={s.selectedPlaceText}>📍 {location.name}</Text>
      <Text style={s.selectedPlaceCoords}>{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</Text>
      <View style={s.nearbyRow}>
        {nearbyCount > 0 ? (
          <>
            <View style={s.nearbyDots}>
              {Array.from({ length: Math.min(nearbyCount, 5) }).map((_, i) => (
                <View key={i} style={s.nearbyDot} />
              ))}
            </View>
            <Text style={s.nearbyText}>{nearbyCount} {nearbyCount === 1 ? 'person' : 'people'} nearby</Text>
          </>
        ) : (
          <Text style={s.nearbyNone}>No one live here yet — question will be posted for later</Text>
        )}
      </View>
      <Text style={s.changePlaceText}>tap to change</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1, padding: 20, paddingTop: 52 },

  heading: { fontSize: 26, fontWeight: '700', color: '#1A1A2E' },
  subheading: { fontSize: 13, color: '#A5A4B4', marginTop: 4, marginBottom: 24 },

  label: { fontSize: 11, color: '#A5A4B4', letterSpacing: 1, marginBottom: 8 },

  locationSection: { marginBottom: 20 },
  locationToggle: { flexDirection: 'row', borderRadius: 10, backgroundColor: '#F5F5F7', padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  toggleActive: { backgroundColor: '#FFFFFF', shadowColor: '#7C5CFC', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleText: { color: '#A5A4B4', fontSize: 13, fontWeight: '600' },
  toggleTextActive: { color: '#7C5CFC' },

  currentLocInfo: { marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  currentLocName: { color: '#7C5CFC', fontSize: 14, fontWeight: '600' },
  currentLocCoords: { color: '#A5A4B4', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 3 },

  searchWrap: { marginTop: 10 },
  searchInput: { color: '#1A1A2E', fontSize: 15, padding: 14, borderRadius: 12, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  searchingText: { color: '#7C5CFC', fontSize: 12, marginTop: 6 },

  selectedPlace: { marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#EDE8FF', borderWidth: 1, borderColor: '#D8D0F5' },
  selectedPlaceText: { color: '#5B3FD4', fontSize: 14, fontWeight: '600' },
  selectedPlaceCoords: { color: '#A5A4B4', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 3 },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  nearbyDots: { flexDirection: 'row', gap: 3 },
  nearbyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#7C5CFC' },
  nearbyText: { color: '#7C5CFC', fontSize: 12, fontWeight: '600' },
  nearbyNone: { color: '#A5A4B4', fontSize: 11 },
  changePlaceText: { color: '#CDCDD8', fontSize: 10, marginTop: 6 },

  resultsWrap: { marginTop: 6, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  resultItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#EEEDF5' },
  resultText: { color: '#1A1A2E', fontSize: 14 },
  resultCoords: { color: '#A5A4B4', fontSize: 10, fontFamily: 'SpaceMono', marginTop: 3 },

  questionSection: { marginBottom: 16 },
  inputCard: { borderRadius: 14, padding: 14, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  textInput: { color: '#1A1A2E', fontSize: 17, minHeight: 70, textAlignVertical: 'top', lineHeight: 24 },
  charCount: { color: '#CDCDD8', fontSize: 11, textAlign: 'right', marginTop: 4, fontFamily: 'SpaceMono' },

  examplesWrap: { marginBottom: 20 },
  examplePill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 6, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  exampleText: { color: '#6E6D7A', fontSize: 13 },

  askBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 24 },
  askBtnDisabled: { opacity: 0.4 },
  askBtnGradient: { paddingVertical: 18, alignItems: 'center', borderRadius: 14, backgroundColor: '#7C5CFC' },
  askBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20 },
  centerText: { color: '#6E6D7A', fontSize: 15, textAlign: 'center' },

  waitingDots: { flexDirection: 'row', gap: 8 },
  waitDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D8D0F5' },
  waitDot1: { backgroundColor: '#7C5CFC' },
  waitDot2: { backgroundColor: '#A890FF' },
  waitDot3: { backgroundColor: '#D8D0F5' },
  waitingTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '700' },
  waitingSub: { color: '#7C5CFC', fontSize: 13 },
  waitingQuestion: { color: '#A5A4B4', fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 20, marginTop: 8 },
  backBtn: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1, borderColor: '#EEEDF5' },
  backBtnText: { color: '#7C5CFC', fontWeight: '600', fontSize: 14 },
  waitingHint: { color: '#CDCDD8', fontSize: 11, marginTop: 8 },

  answerBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, backgroundColor: '#EEFBF1', marginTop: 20, marginBottom: 16 },
  answerBadgeText: { color: '#34C759', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  answerQuestion: { color: '#A5A4B4', fontSize: 14, fontStyle: 'italic', marginBottom: 16 },
  answerCard: { padding: 18, borderRadius: 14, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5', marginBottom: 20 },
  answerText: { color: '#1A1A2E', fontSize: 16, lineHeight: 24 },
  answerMeta: { color: '#A5A4B4', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 10 },

  rateRow: { marginBottom: 20 },
  rateLabel: { color: '#6E6D7A', fontSize: 13, marginBottom: 10 },
  rateBtns: { flexDirection: 'row', gap: 10 },
  rateBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  rateBtnText: { color: '#1A1A2E', fontSize: 15, fontWeight: '600' },
  ratedText: { color: '#34C759', fontSize: 13, textAlign: 'center', marginBottom: 20 },

  newBtn: { alignSelf: 'center', padding: 12 },
  newBtnText: { color: '#7C5CFC', fontSize: 14, fontWeight: '600' },

  errorText: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1, borderColor: '#EEEDF5' },
  retryText: { color: '#1A1A2E', fontWeight: '600' },

  recentSection: { marginTop: 8 },
  recentCard: { padding: 14, borderRadius: 12, marginBottom: 10, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#EEEDF5' },
  recentQuestion: { color: '#1A1A2E', fontSize: 14, marginBottom: 8 },
  recentAnswerWrap: { padding: 10, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEEDF5' },
  recentAnswerLabel: { fontSize: 10, color: '#A5A4B4', letterSpacing: 1, marginBottom: 4 },
  recentAnswer: { color: '#1A1A2E', fontSize: 14, lineHeight: 20 },
  recentPending: { color: '#FF9500', fontSize: 12 },
  recentExpired: { color: '#A5A4B4', fontSize: 12 },
});
