import { supabase } from './supabase';
import { startLiveTracking, stopLiveTracking, getCurrentLocation } from './location';

export interface LiveSession {
  id: string;
  user_id: string;
  status: 'live' | 'ended' | 'expired';
  started_at: string;
  expires_at: string;
  earnings_usdc: number;
  queries_answered: number;
}

/**
 * Start a live session — creates DB record + starts background tracking
 */
export async function goLive(
  userId: string,
  durationMinutes: number = 120
): Promise<{ session?: LiveSession; error?: string }> {
  // 1. Get current location
  const loc = await getCurrentLocation();
  if (!loc) {
    return { error: 'Could not get your location' };
  }

  // 2. Check if already live
  const { data: existing } = await supabase
    .from('live_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'live')
    .single();

  if (existing) {
    return { error: 'You are already live! Stop your current session first.' };
  }

  // 3. Create live session in Supabase
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  // Use raw SQL via RPC because Supabase JS client can't directly insert GEOGRAPHY type
  const { data, error } = await supabase.rpc('create_live_session', {
    p_user_id: userId,
    p_lng: loc.lng,
    p_lat: loc.lat,
    p_expires_at: expiresAt,
  });

  if (error) {
    return { error: error.message };
  }

  // 4. Upsert initial location
  await supabase.rpc('upsert_location', {
    p_user_id: userId,
    p_lng: loc.lng,
    p_lat: loc.lat,
    p_accuracy: loc.accuracy,
  });

  // 5. Start background tracking
  try {
    await startLiveTracking();
  } catch (err: any) {
    // If tracking fails, still keep the session — foreground updates will work
    console.warn('[GoLive] Background tracking failed:', err.message);
  }

  return { session: data };
}

/**
 * Stop a live session — updates DB + stops background tracking
 */
export async function stopLive(userId: string): Promise<void> {
  // 1. Update all active sessions to 'ended'
  await supabase
    .from('live_sessions')
    .update({ status: 'ended' })
    .eq('user_id', userId)
    .eq('status', 'live');

  // 2. Stop background tracking
  await stopLiveTracking();
}

/**
 * Get current live session (if any)
 */
export async function getActiveLiveSession(
  userId: string
): Promise<LiveSession | null> {
  const { data } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'live')
    .gt('expires_at', new Date().toISOString())
    .single();

  return data;
}

/**
 * Get stats for nearby activity (to show earning potential)
 */
export async function getNearbyStats(
  lat: number,
  lng: number
): Promise<{ queriesNearby: number; liveUsers: number }> {
  // Count recent queries near this location
  const { count: queriesNearby } = await supabase
    .from('queries')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // Count live users nearby
  const { data: liveUsers } = await supabase
    .rpc('find_live_responders', {
      p_lng: lng,
      p_lat: lat,
      p_radius_m: 2000,
    });

  return {
    queriesNearby: queriesNearby || 0,
    liveUsers: liveUsers?.length || 0,
  };
}