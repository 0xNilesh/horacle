import { StyleSheet, TouchableOpacity, ScrollView, Image, TextInput } from 'react-native';
import { Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { getUser, clearUser, type HoracleUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { reverseGeocode } from '@/lib/geocode';
import { getWorldUsername } from '@/lib/username';
import { getCurrentLocation } from '@/lib/location';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const [user, setUser] = useState<HoracleUser | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [queryCount, setQueryCount] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const u = await getUser();
    setUser(u);
    if (!u) return;

    // Check if user has a display name set
    if (u.display_name) setUsername(u.display_name);

    // Get location
    const loc = await getCurrentLocation();
    if (loc) {
      const name = await reverseGeocode(loc.lat, loc.lng);
      setPlaceName(name);
    }

    // Fresh stats from DB
    const { data: freshUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', u.id)
      .single();

    if (freshUser) {
      setUser({
        ...u,
        reputation_score: freshUser.reputation_score,
        total_earned_usdc: freshUser.total_earned_usdc,
        total_queries_answered: freshUser.total_queries_answered,
      });
    }

    const { count: sessions } = await supabase
      .from('live_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id);
    setSessionCount(sessions || 0);

    const { count: queries } = await supabase
      .from('queries')
      .select('id', { count: 'exact', head: true })
      .eq('asker_id', u.id);
    setQueryCount(queries || 0);
  };

  const handleSignOut = async () => {
    await clearUser();
    router.replace('/(auth)/verify');
  };

  if (!user) return null;

  return (
    <View style={s.container}>
      <LinearGradient colors={['#000', '#0a0015', '#000']} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>🧑‍💻</Text>
          </View>

          {editingName ? (
            <View style={s.nameEditWrap}>
              <Text style={s.nameEditLabel}>Enter your World App username</Text>
              <View style={s.nameEditRow}>
                <TextInput
                  style={s.nameInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="e.g. nilesh"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  autoFocus
                  maxLength={30}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[s.nameSaveBtn, !nameInput.trim() && { opacity: 0.4 }]}
                  disabled={!nameInput.trim()}
                  onPress={async () => {
                    const trimmed = nameInput.trim();
                    if (!trimmed) return;
                    // Fetch from World username API
                    const { getWorldUsername } = await import('@/lib/username');
                    // Try looking up by username
                    try {
                      const res = await fetch('https://usernames.worldcoin.org/api/v1/query', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ addresses: [], usernames: [trimmed] }),
                      });
                      const data = await res.json();
                      if (data.length > 0) {
                        const worldUser = data[0];
                        // Save username, wallet address, and profile pic
                        await supabase.from('users').update({
                          display_name: worldUser.username,
                          wallet_address: worldUser.address,
                        }).eq('id', user.id);
                        setUsername(worldUser.username);
                        if (worldUser.profile_picture_url) setProfilePic(worldUser.profile_picture_url);
                        // Update local user
                        setUser({ ...user, display_name: worldUser.username, wallet_address: worldUser.address });
                      } else {
                        // Username not found — just save as display name
                        await supabase.from('users').update({ display_name: trimmed }).eq('id', user.id);
                        setUsername(trimmed);
                      }
                    } catch {
                      await supabase.from('users').update({ display_name: trimmed }).eq('id', user.id);
                      setUsername(trimmed);
                    }
                    setEditingName(false);
                  }}
                >
                  <Text style={s.nameSaveText}>Link</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => { setNameInput(username || ''); setEditingName(true); }}>
              <Text style={s.displayName}>{username || 'Link World Username'}</Text>
              {!username && <Text style={s.nameHint}>Tap to connect your World App profile</Text>}
            </TouchableOpacity>
          )}

          <View style={s.verifiedBadge}>
            <Text style={s.verifiedText}>🛡️ World ID Verified</Text>
          </View>
        </View>

        {/* ID Card */}
        <View style={s.idCard}>
          {username && (
            <View style={s.idRow}>
              <Text style={s.idLabel}>USERNAME</Text>
              <Text style={s.idValue} numberOfLines={1}>{username}</Text>
            </View>
          )}
          <View style={s.idRow}>
            <Text style={s.idLabel}>WORLD ID</Text>
            <Text style={s.idValue} numberOfLines={1}>{user.world_id_nullifier.slice(0, 16)}...</Text>
          </View>
          {placeName ? (
            <View style={s.idRow}>
              <Text style={s.idLabel}>LOCATION</Text>
              <Text style={s.idValue} numberOfLines={1} ellipsizeMode="tail">{placeName}</Text>
            </View>
          ) : null}
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          {[
            { icon: '💰', value: `$${user.total_earned_usdc.toFixed(2)}`, label: 'Earned' },
            { icon: '💬', value: `${user.total_queries_answered}`, label: 'Answered' },
            { icon: '⭐', value: `${user.reputation_score.toFixed(1)}`, label: 'Rep' },
          ].map((stat) => (
            <View key={stat.label} style={s.statBox}>
              <Text style={s.statIcon}>{stat.icon}</Text>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.statsRow}>
          {[
            { icon: '📍', value: `${sessionCount}`, label: 'Sessions' },
            { icon: '❓', value: `${queryCount}`, label: 'Asked' },
            { icon: '⚡', value: user.total_queries_answered > 0 ? '~12s' : '—', label: 'Speed' },
          ].map((stat) => (
            <View key={stat.label} style={s.statBox}>
              <Text style={s.statIcon}>{stat.icon}</Text>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={s.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Reputation bar */}
        <View style={s.repSection}>
          <Text style={s.sectionLabel}>REPUTATION</Text>
          <View style={s.repBar}>
            <View style={[s.repFill, { width: `${(user.reputation_score / 5) * 100}%` }]} />
          </View>
          <View style={s.repLabels}>
            <Text style={s.repLabelText}>0</Text>
            <Text style={s.repLabelText}>{user.reputation_score.toFixed(1)} / 5.0</Text>
            <Text style={s.repLabelText}>5</Text>
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={s.version}>Horacle v1.0 · ETHGlobal Cannes 2026</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scroll: { padding: 20, paddingTop: 52, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(167,139,250,0.1)', borderWidth: 2, borderColor: 'rgba(167,139,250,0.25)',
    marginBottom: 12,
  },
  avatarImg: {
    width: 80, height: 80, borderRadius: 40, marginBottom: 12,
    borderWidth: 2, borderColor: 'rgba(167,139,250,0.25)',
  },
  avatarText: { fontSize: 36 },
  displayName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  nameHint: { color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center', marginTop: 4 },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', paddingHorizontal: 20 },
  nameInput: {
    flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', paddingVertical: 8, paddingHorizontal: 12,
    borderBottomWidth: 2, borderBottomColor: '#a78bfa', textAlign: 'center',
  },
  nameSaveBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#7c3aed' },
  nameSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  verifiedBadge: {
    marginTop: 8, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: 'rgba(167,139,250,0.1)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)',
  },
  verifiedText: { color: '#a78bfa', fontSize: 12, fontWeight: '600' },

  idCard: {
    padding: 16, borderRadius: 14, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  idRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  idLabel: { fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.5, fontFamily: 'SpaceMono', width: 80 },
  idValue: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'SpaceMono', flex: 1, textAlign: 'right' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statBox: {
    flex: 1, padding: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: '#fff', fontFamily: 'SpaceMono' },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 3, letterSpacing: 1 },

  repSection: { marginTop: 10, marginBottom: 24 },
  sectionLabel: { fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: 2, fontFamily: 'SpaceMono', marginBottom: 10 },
  repBar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  repFill: { height: '100%', borderRadius: 4, backgroundColor: '#a78bfa' },
  repLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  repLabelText: { fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'SpaceMono' },

  signOutBtn: {
    alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,60,60,0.25)', backgroundColor: 'rgba(255,60,60,0.06)',
    marginBottom: 20,
  },
  signOutText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  version: { color: 'rgba(255,255,255,0.1)', fontSize: 10, fontFamily: 'SpaceMono', textAlign: 'center' },
});
