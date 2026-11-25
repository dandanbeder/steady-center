// what3words API (https://developer.what3words.com). Optional: set VITE_WHAT3WORDS_API_KEY
// (restrict it to your site in the what3words dashboard). Without a key, three-word addresses are
// still recorded and linked, but not checked or placed on the map.
import type { LatLng } from "@/domain/geo";

export const W3W_KEY = (import.meta.env.VITE_WHAT3WORDS_API_KEY as string | undefined) || "";
export const hasW3W = !!W3W_KEY;
const BASE = "https://api.what3words.com/v3";

export interface W3WSquare {
  words: string;
  nearestPlace: string;
  coordinates: LatLng;
}

export interface W3WSuggestion {
  words: string;
  nearestPlace: string;
  distanceToFocusKm?: number;
}

async function call<T>(path: string, params: Record<string, string>, fetcher: typeof fetch = fetch): Promise<T> {
  const q = new URLSearchParams({ ...params, key: W3W_KEY, language: "en" });
  const res = await fetcher(`${BASE}/${path}?${q}`);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `what3words error ${res.status}`);
  return body as T;
}

interface RawSquare {
  words: string;
  nearestPlace: string;
  coordinates: LatLng;
}

/** Three words → square. Throws if the words are not a real address. */
export async function toCoordinates(words: string, fetcher?: typeof fetch): Promise<W3WSquare> {
  const r = await call<RawSquare>("convert-to-coordinates", { words }, fetcher);
  return { words: r.words, nearestPlace: r.nearestPlace, coordinates: r.coordinates };
}

/** Pin → three words, so the dispatcher can read them back to the caller. */
export async function to3wa(p: LatLng, fetcher?: typeof fetch): Promise<W3WSquare> {
  const r = await call<RawSquare>("convert-to-3wa", { coordinates: `${p.lat},${p.lng}` }, fetcher);
  return { words: r.words, nearestPlace: r.nearestPlace, coordinates: r.coordinates };
}

/** Catches misheard words: suggestions clipped to Australia, nearest the focus first. */
export async function autosuggest(input: string, focus?: LatLng, fetcher?: typeof fetch): Promise<W3WSuggestion[]> {
  const params: Record<string, string> = { input, "clip-to-country": "AU", "n-results": "3" };
  if (focus) params.focus = `${focus.lat},${focus.lng}`;
  const r = await call<{ suggestions: W3WSuggestion[] }>("autosuggest", params, fetcher);
  return r.suggestions ?? [];
}
