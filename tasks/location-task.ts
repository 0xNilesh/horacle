import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { LOCATION_TASK_NAME } from '../lib/location';

// Dedicated key just for the background task — simpler than parsing JSON
const BG_USER_ID_KEY = 'horacle_bg_user_id';

// Export so other code can set it
export async function setBgUserId(userId: string) {
  await SecureStore.setItemAsync(BG_USER_ID_KEY, userId);
}

export async function clearBgUserId() {
  await SecureStore.deleteItemAsync(BG_USER_ID_KEY);
}

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

  // Read user ID from dedicated key
  let userId: string | null = null;
  try {
    userId = await SecureStore.getItemAsync(BG_USER_ID_KEY);

    // Fallback: try the main user object
    if (!userId) {
      const userData = await SecureStore.getItemAsync('horacle_user');
      if (userData) {
        const user = JSON.parse(userData);
        userId = user.id;
        // Save to dedicated key for next time
        if (userId) await SecureStore.setItemAsync(BG_USER_ID_KEY, userId);
      }
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
  if (!supabase) return;

  try {
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
