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

    // Check wallet (will be needed for payment in Phase 5)
    // For now just warn, don't block
    const hasWallet = await hasRealWallet();
    if (!hasWallet) {
      console.log('[Ask] No real wallet connected — proceeding anyway (payment will fail later)');
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

    const result = await askQuestion(currentUser.id, question.trim(), lat, lng);

    if (result.error) {
      setStatusText(result.error);
      setState('error');
      return;
    }

    setCurrentQuery(result.query!);
    setState('waiting');
    if (result.responders && result.responders > 0) {
      setStatusText(`Sent to ${result.responders} people nearby`);
    } else {
      setStatusText('No one nearby right now — your question is posted and anyone who goes live near there will see it');
    }

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
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

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
  container: { flex: 1, backgroundColor: '#000' },
  scroll: { flex: 1, padding: 20, paddingTop: 52 },

  heading: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  subheading: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4, marginBottom: 24 },

  label: { fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 10 },

  // Location
  locationSection: { marginBottom: 20 },
  locationToggle: {
    flexDirection: 'row', borderRadius: 10, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)', padding: 3,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  toggleActive: { backgroundColor: 'rgba(167,139,250,0.15)' },
  toggleText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: '600' },
  toggleTextActive: { color: '#a78bfa' },

  currentLocInfo: {
    marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(167,139,250,0.06)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.12)',
  },
  currentLocName: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  currentLocCoords: { color: 'rgba(255,255,255,0.2)', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 3 },

  searchWrap: { marginTop: 10 },
  searchInput: {
    color: '#fff', fontSize: 15, padding: 14, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.15)',
  },
  searchingText: { color: 'rgba(167,139,250,0.5)', fontSize: 12, marginTop: 6, marginLeft: 4 },

  selectedPlace: {
    marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(167,139,250,0.08)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)',
  },
  selectedPlaceText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  selectedPlaceCoords: { color: 'rgba(255,255,255,0.2)', fontSize: 11, fontFamily: 'SpaceMono', marginTop: 3 },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  nearbyDots: { flexDirection: 'row', gap: 3 },
  nearbyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a78bfa' },
  nearbyText: { color: 'rgba(167,139,250,0.7)', fontSize: 12, fontWeight: '600' },
  nearbyNone: { color: 'rgba(255,255,255,0.2)', fontSize: 11 },
  changePlaceText: { color: 'rgba(255,255,255,0.15)', fontSize: 10, marginTop: 6 },

  resultsWrap: {
    marginTop: 6, borderRadius: 10, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  resultItem: {
    padding: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  resultText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  resultCoords: { color: 'rgba(255,255,255,0.15)', fontSize: 10, fontFamily: 'SpaceMono', marginTop: 3 },

  // Question
  questionSection: { marginBottom: 16 },
  inputCard: {
    borderRadius: 14, padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.12)',
  },
  textInput: { color: '#fff', fontSize: 17, minHeight: 70, textAlignVertical: 'top', lineHeight: 24 },
  charCount: { color: 'rgba(255,255,255,0.15)', fontSize: 11, textAlign: 'right', marginTop: 4, fontFamily: 'SpaceMono' },

  // Examples
  examplesWrap: { marginBottom: 20 },
  examplePill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  exampleText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },

  // Ask button
  askBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  askBtnDisabled: { opacity: 0.5 },
  askBtnGradient: { paddingVertical: 18, alignItems: 'center', borderRadius: 16 },
  askBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },

  // Center states
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
  centerText: { color: 'rgba(255,255,255,0.5)', fontSize: 15, textAlign: 'center' },

  // Waiting
  waitingDots: { flexDirection: 'row', gap: 8 },
  waitDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(167,139,250,0.3)' },
  waitDot1: { backgroundColor: '#a78bfa' },
  waitDot2: { backgroundColor: 'rgba(167,139,250,0.6)' },
  waitDot3: { backgroundColor: 'rgba(167,139,250,0.3)' },
  waitingTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  waitingSub: { color: 'rgba(167,139,250,0.6)', fontSize: 13 },
  waitingQuestion: { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 20, marginTop: 8 },
  backBtn: {
    marginTop: 24, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.25)',
  },
  backBtnText: { color: '#a78bfa', fontWeight: '600', fontSize: 14 },
  waitingHint: { color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8 },

  // Answer
  answerBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(167,139,250,0.15)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)',
    marginTop: 20, marginBottom: 16,
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

  newBtn: { alignSelf: 'center', padding: 12 },
  newBtnText: { color: 'rgba(167,139,250,0.7)', fontSize: 14, fontWeight: '600' },

  // Error / retry
  errorText: { color: '#f87171', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  retryText: { color: '#fff', fontWeight: '600' },

  // Recent
  recentSection: { marginTop: 8 },
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
  recentPending: { color: 'rgba(167,139,250,0.5)', fontSize: 12 },
  recentExpired: { color: 'rgba(255,255,255,0.2)', fontSize: 12 },
});
