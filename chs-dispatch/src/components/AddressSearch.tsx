import { useEffect, useRef, useState } from "react";
import { SYDNEY_BOUNDS, partsFromComponents, type LatLng } from "@/domain/geo";
import { hasMaps, mapsLibs } from "@/lib/maps";

export interface PickedAddress {
  street_address: string;
  suburb: string;
  location: LatLng;
  formatted: string;
}

/** Google Places address search (Places API (New) autocomplete element), biased to Sydney, AU only. */
export default function AddressSearch({ onPick, disabled }: { onPick: (a: PickedAddress) => void; disabled?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasMaps || !host.current) return;
    let cancelled = false;
    let el: google.maps.places.PlaceAutocompleteElement | null = null;
    mapsLibs()
      .then(({ places }) => {
        if (cancelled || !host.current) return;
        el = new places.PlaceAutocompleteElement({
          includedRegionCodes: ["au"],
          locationBias: SYDNEY_BOUNDS,
          placeholder: "Search address or place (Google)",
        });
        el.style.width = "100%";
        el.addEventListener("gmp-select", async (ev) => {
          try {
            const place = (ev as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
            await place.fetchFields({ fields: ["addressComponents", "location", "formattedAddress", "displayName"] });
            if (!place.location) return;
            const parts = partsFromComponents(place.addressComponents ?? []);
            onPickRef.current({
              street_address: parts.street_address || place.displayName || "",
              suburb: parts.suburb,
              location: { lat: place.location.lat(), lng: place.location.lng() },
              formatted: place.formattedAddress ?? "",
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        });
        host.current.replaceChildren(el);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, []);

  if (!hasMaps) return null;
  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <div ref={host} className="min-h-10" />
      {error && <p className="mt-1 text-xs text-amber-900">Address search unavailable: {error}</p>}
    </div>
  );
}
