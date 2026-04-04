import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { LOCATION_TASK_NAME } from '../lib/location';

// IMPORTANT: This file must be imported at the top level (e.g., in _layout.tsx)
// TaskManager.defineTask must run at module import time, outside of any component.

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }

  if (!data) return;

  const { locations } = data as {
    locations: Array<{
      coords: {
        latitude: number;
        longitude: number;
        accuracy: number | null;
      };
      timestamp: number;
    }>;
  };

  const loc = locations[0];
  if (!loc) return;

  // TODO: Get user_id from secure storage
  // For now, use a placeholder — will be replaced in Phase 1
  const userId = 'placeholder';

  try {
    await supabase.rpc('upsert_location', {
      p_user_id: userId,
      p_lng: loc.coords.longitude,
      p_lat: loc.coords.latitude,
      p_accuracy: loc.coords.accuracy,
    });
  } catch (err) {
    console.error('Failed to sync location:', err);
  }
});
