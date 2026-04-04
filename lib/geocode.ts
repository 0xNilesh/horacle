export interface GeoResult {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Reverse geocode — get place name from coordinates (free, Photon)
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`;
    console.log('[Geocode] Reverse:', url);
    const res = await fetch(url);
    console.log('[Geocode] Reverse status:', res.status);
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const data = await res.json();
    const f = data.features?.[0];
    if (!f) {
      console.log('[Geocode] No features in reverse result');
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    const p = f.properties;
    console.log('[Geocode] Reverse result:', JSON.stringify(p));
    const parts = [p.name, p.street, p.city].filter(Boolean);
    return parts.join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch (err) {
    console.error('[Geocode] Reverse error:', err);
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

/**
 * Search for a place using Photon API (free, by Komoot, no API key needed)
 * Much better than Nominatim for natural language queries
 */
export async function searchPlace(query: string, nearLat?: number, nearLng?: number): Promise<GeoResult[]> {
  try {
    console.log('[Geocode] Searching:', query);

    // Add location bias if available (prioritizes results near the user)
    const bias = nearLat && nearLng ? `&lat=${nearLat}&lon=${nearLng}` : '';
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en${bias}`
    );

    if (!res.ok) return [];

    const data = await res.json();
    console.log('[Geocode] Results:', data.features?.length || 0);

    return (data.features || []).map((f: any) => {
      const props = f.properties;
      const parts = [props.name, props.city || props.county, props.country].filter(Boolean);
      return {
        name: parts.join(', '),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      };
    });
  } catch (err) {
    console.error('[Geocode] Error:', err);
    return [];
  }
}
