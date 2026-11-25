// Google Maps JavaScript API loader. Configure VITE_GOOGLE_MAPS_API_KEY (a browser key restricted
// to your site's URLs, with Maps JavaScript API and Places API (New) enabled). Without a key the
// app falls back to typed addresses and plain Google Maps links.

export const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "";
/** Advanced markers need a Map ID. DEMO_MAP_ID works for testing; create your own for production. */
export const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";
export const hasMaps = !!MAPS_KEY;

let loading: Promise<typeof google.maps> | null = null;

export function loadMaps(): Promise<typeof google.maps> {
  if (!hasMaps) return Promise.reject(new Error("Google Maps is not configured"));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = `__chsMapsReady${Date.now()}`;
    (window as unknown as Record<string, unknown>)[cb] = () => resolve(google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&region=AU&language=en-AU&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function mapsLibs() {
  const maps = await loadMaps();
  const [{ Map }, { AdvancedMarkerElement, PinElement }, places] = await Promise.all([
    maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    maps.importLibrary("places") as Promise<google.maps.PlacesLibrary>,
  ]);
  return { Map, AdvancedMarkerElement, PinElement, places };
}
