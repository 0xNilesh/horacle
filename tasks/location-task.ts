import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { LOCATION_TASK_NAME } from '../lib/location';

// IMPORTANT: Must be imported at module level in _layout.tsx

// We create a standalone Supabase client here because this task
// runs in a background context where normal imports may not be available
function getSupabase() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key);
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[BG Location] Error:', error);
    return;
  }
  if (!data) return;

  const { locations } = data as {
    locations: Array<{
      coords: { latitude: number; longitude: number; accuracy: number | null };
      timestamp: number;
    }>;
  };

  const loc = locations[0];
  if (!loc) return;

  // Get user ID from storage
  let userId: string | null = null;
  try {
    const userData = await SecureStore.getItemAsync('horacle_user');
    if (userData) {
      const user = JSON.parse(userData);
      userId = user.id;
    }
  } catch {
    console.error('[BG Location] Could not read user from storage');
    return;
  }

  if (!userId) {
    console.log('[BG Location] No user ID — skipping sync');
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error('[BG Location] No Supabase client');
    return;
  }

  try {
    // Update user_locations (real-time position)
    const { error: locError } = await supabase.rpc('upsert_location', {
      p_user_id: userId,
      p_lng: loc.coords.longitude,
      p_lat: loc.coords.latitude,
      p_accuracy: loc.coords.accuracy,
    });

    if (locError) {
      console.error('[BG Location] Supabase error:', locError.message);
    } else {
      console.log(`[BG Location] Synced: ${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
    }
  } catch (err) {
    console.error('[BG Location] Failed:', err);
  }
});
