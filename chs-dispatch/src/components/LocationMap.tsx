import { useEffect, useRef, useState } from "react";
import { SYDNEY, type LatLng } from "@/domain/geo";
import { MAP_ID, hasMaps, mapsLibs } from "@/lib/maps";

export interface MapPin {
  id: string;
  position: LatLng;
  label?: string;
  colour?: string;
  draggable?: boolean;
  onClick?: () => void;
}

/**
 * A Google map with pins. One draggable pin + onMove makes it a location picker; several
 * pins make it an overview. Renders nothing when Google Maps isn't configured.
 */
export default function LocationMap({
  pins,
  onMove,
  height = 260,
  zoom = 16,
  fitAll,
}: {
  pins: MapPin[];
  /** Called when a draggable pin is dragged, or the map is clicked to place it. */
  onMove?: (p: LatLng) => void;
  height?: number;
  zoom?: number;
  fitAll?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const libs = useRef<Awaited<ReturnType<typeof mapsLibs>> | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasMaps || !el.current) return;
    let cancelled = false;
    mapsLibs()
      .then((l) => {
        if (cancelled || !el.current) return;
        libs.current = l;
        map.current = new l.Map(el.current, {
          center: pins[0]?.position ?? SYDNEY,
          zoom: pins.length ? zoom : 11,
          mapId: MAP_ID,
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          clickableIcons: false,
        });
        map.current.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (onMoveRef.current && e.latLng) onMoveRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        setReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pins.
  useEffect(() => {
    const m = map.current;
    const l = libs.current;
    if (!ready || !m || !l) return;
    const seen = new Set<string>();
    for (const p of pins) {
      seen.add(p.id);
      let mk = markers.current.get(p.id);
      if (!mk) {
        const pin = new l.PinElement({ background: p.colour ?? "#d71920", borderColor: "#12303f", glyphColor: "#ffffff", glyphText: p.label?.slice(0, 2) });
        mk = new l.AdvancedMarkerElement({ map: m, position: p.position, content: pin, title: p.label, gmpDraggable: !!p.draggable });
        if (p.draggable) {
          mk.addListener("dragend", () => {
            const pos = mk!.position as google.maps.LatLngLiteral | google.maps.LatLng | null;
            if (!pos) return;
            const ll = typeof (pos as google.maps.LatLng).lat === "function" ? { lat: (pos as google.maps.LatLng).lat(), lng: (pos as google.maps.LatLng).lng() } : (pos as LatLng);
            onMoveRef.current?.(ll);
          });
        }
        if (p.onClick) mk.addListener("gmp-click", p.onClick);
        markers.current.set(p.id, mk);
      } else {
        mk.position = p.position;
      }
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.map = null;
        markers.current.delete(id);
      }
    }
    if (fitAll && pins.length > 1) {
      const b = new google.maps.LatLngBounds();
      pins.forEach((p) => b.extend(p.position));
      m.fitBounds(b, 48);
    } else if (pins.length) {
      m.panTo(pins[0].position);
      if ((m.getZoom() ?? 0) < 14) m.setZoom(zoom);
    }
  }, [pins, ready, fitAll, zoom]);

  if (!hasMaps) return null;
  if (error) return <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Map unavailable: {error}</p>;
  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100" />;
}
