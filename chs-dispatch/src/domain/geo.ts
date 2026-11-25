// Location helpers that need no API key: map links work for everyone, including responders.

export interface LatLng {
  lat: number;
  lng: number;
}

/** CHS operates around Sydney; used to bias searches and sanity-check pins. */
export const SYDNEY: LatLng = { lat: -33.8688, lng: 151.2093 };
export const SYDNEY_BOUNDS = { south: -34.2, west: 150.6, north: -33.4, east: 151.4 };

export function isLatLng(v: { latitude?: number | null; longitude?: number | null }): v is { latitude: number; longitude: number } {
  return typeof v.latitude === "number" && typeof v.longitude === "number" && Number.isFinite(v.latitude) && Number.isFinite(v.longitude);
}

export function inSydneyArea(p: LatLng): boolean {
  return p.lat >= SYDNEY_BOUNDS.south && p.lat <= SYDNEY_BOUNDS.north && p.lng >= SYDNEY_BOUNDS.west && p.lng <= SYDNEY_BOUNDS.east;
}

export const fmtLatLng = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** Turn-by-turn directions in Google Maps (app on phones). No API key needed. */
export function directionsUrl(dest: LatLng | string): string {
  const d = typeof dest === "string" ? dest : fmtLatLng(dest);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}&travelmode=driving`;
}

export function mapSearchUrl(q: LatLng | string): string {
  const s = typeof q === "string" ? q : fmtLatLng(q);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s)}`;
}

/** Straight-line distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface AddressParts {
  street_address: string;
  suburb: string;
}

/** Google address components → the dispatch template's street + suburb. */
export function partsFromComponents(components: { longText?: string | null; shortText?: string | null; types: string[] }[]): AddressParts {
  const get = (t: string) => components.find((c) => c.types.includes(t));
  const number = get("street_number")?.longText ?? "";
  const route = get("route")?.shortText ?? get("route")?.longText ?? "";
  const premise = get("premise")?.longText ?? get("establishment")?.longText ?? get("point_of_interest")?.longText ?? "";
  const suburb = get("locality")?.longText ?? get("sublocality")?.longText ?? get("postal_town")?.longText ?? "";
  const street = [number, route].filter(Boolean).join(" ") || premise;
  return { street_address: street, suburb };
}
