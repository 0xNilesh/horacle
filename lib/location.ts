import * as Location from 'expo-location';

export const LOCATION_TASK_NAME = 'HORACLE_BACKGROUND_LOCATION';

export async function requestLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { foreground: false, background: false };
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    foreground: true,
    background: bg.status === 'granted',
  };
}

export async function startLiveTracking(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000, // Android: every 15 seconds
    distanceInterval: 5, // iOS: every 5 meters
    deferredUpdatesInterval: 15000, // iOS: at least every 15 seconds
    showsBackgroundLocationIndicator: true, // iOS blue bar
    foregroundService: {
      notificationTitle: 'Horacle — Earning Mode',
      notificationBody: 'You\'re available for nearby questions · ~$0.05 per answer',
      notificationColor: '#7c3aed',
    },
  });
}

export async function stopLiveTracking(): Promise<void> {
  const isTracking = await Location.hasStartedLocationUpdatesAsync(
    LOCATION_TASK_NAME
  );
  if (isTracking) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

export async function getCurrentLocation(): Promise<{
  lat: number;
  lng: number;
  accuracy: number | null;
} | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
    };
  } catch {
    return null;
  }
}
