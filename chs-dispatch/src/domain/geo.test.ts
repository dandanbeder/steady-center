import { describe, expect, it } from "vitest";
import { directionsUrl, distanceKm, inSydneyArea, mapSearchUrl, partsFromComponents } from "./geo";
import { buildResponseMessage, navigationUrl } from "./message";
import { emptyIntake } from "./triage";
import { autosuggest, to3wa, toCoordinates } from "@/lib/w3w";

describe("geo helpers", () => {
  it("builds keyless Google Maps links", () => {
    expect(directionsUrl({ lat: -33.85, lng: 151.27 })).toBe("https://www.google.com/maps/dir/?api=1&destination=-33.85000%2C151.27000&travelmode=driving");
    expect(mapSearchUrl("10 Campbell Pde, Bondi")).toContain("query=10%20Campbell%20Pde%2C%20Bondi");
  });
  it("distance and area checks", () => {
    expect(distanceKm({ lat: -33.8915, lng: 151.2767 }, { lat: -33.8721, lng: 151.2595 })).toBeCloseTo(2.7, 0);
    expect(inSydneyArea({ lat: -33.89, lng: 151.27 })).toBe(true);
    expect(inSydneyArea({ lat: -37.81, lng: 144.96 })).toBe(false);
  });
  it("maps Google address components to street and suburb", () => {
    const c = [
      { longText: "10", types: ["street_number"] },
      { longText: "Campbell Parade", shortText: "Campbell Pde", types: ["route"] },
      { longText: "Bondi Beach", types: ["locality", "political"] },
    ];
    expect(partsFromComponents(c)).toEqual({ street_address: "10 Campbell Pde", suburb: "Bondi Beach" });
    expect(partsFromComponents([{ longText: "Nielsen Park", types: ["establishment"] }, { longText: "Vaucluse", types: ["locality"] }])).toEqual({ street_address: "Nielsen Park", suburb: "Vaucluse" });
  });
  it("responders get directions to the pin, and the message carries a map link", () => {
    const i = { ...emptyIntake(), street_address: "Nielsen Park", suburb: "Vaucluse", what3words: "filled.count.soap", latitude: -33.85, longitude: 151.27, location_source: "pin" as const };
    expect(navigationUrl(i)).toContain("/maps/dir/");
    expect(buildResponseMessage("X", i, "yellow")).toContain("MAP: https://www.google.com/maps/search/?api=1&query=-33.85000%2C151.27000");
  });
});

describe("what3words client", () => {
  const fake = (body: unknown, ok = true) => (async (url: string) => {
    fake.last = url;
    return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
  }) as unknown as typeof fetch & { last?: string };
  it("converts words to a square", async () => {
    const f = fake({ words: "filled.count.soap", nearestPlace: "Vaucluse, NSW", coordinates: { lat: -33.85, lng: 151.27 } });
    const sq = await toCoordinates("filled.count.soap", f);
    expect(sq.coordinates.lat).toBe(-33.85);
    expect((fake as { last?: string }).last).toContain("convert-to-coordinates?words=filled.count.soap");
  });
  it("converts a pin to words", async () => {
    const f = fake({ words: "index.home.raft", nearestPlace: "Bondi, NSW", coordinates: { lat: -33.89, lng: 151.27 } });
    expect((await to3wa({ lat: -33.89, lng: 151.27 }, f)).words).toBe("index.home.raft");
  });
  it("surfaces API errors and suggests corrections clipped to Australia", async () => {
    await expect(toCoordinates("filled.count.soup", fake({ error: { code: "BadWords", message: "Invalid or non-existent 3 word address" } }, false))).rejects.toThrow("non-existent");
    const f = fake({ suggestions: [{ words: "filled.count.soap", nearestPlace: "Vaucluse, NSW" }] });
    expect((await autosuggest("filled.count.soup", { lat: -33.85, lng: 151.27 }, f))[0].words).toBe("filled.count.soap");
    expect((fake as { last?: string }).last).toContain("clip-to-country=AU");
  });
});
