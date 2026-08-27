import { describe, it, expect } from "vitest";
import { composedResolver } from "../../../src/cli/import/artifacts/resolver-kit.js";

// A fake facade whose `value(property)` returns pre-resolved sibling values and
// counts reads — so the test can prove the composed resolver reads each sibling
// once (a shared upstream geocode would run once behind that memoization).
function fakeFacade(resolved: Record<string, unknown>) {
  const reads: string[] = [];
  return {
    reads,
    context: {
      facade: {
        value: async (property: string) => {
          reads.push(property);
          return resolved[property];
        },
        raw: () => undefined,
      },
      source: { namespace: "org.subs", name: "n" },
      backend: {},
    } as never,
  };
}

// A GeoJSON Point delegate over resolved coordinates — coordinates are [lng, lat].
const geoJsonPoint = composedResolver<
  { type: "Point"; coordinates: [number, number] } | null,
  { latitude: number; longitude: number }
>(["latitude", "longitude"], ([lat, lng]) =>
  typeof lat === "number" && typeof lng === "number"
    ? { type: "Point", coordinates: [lng, lat] }
    : null,
);

describe("composedResolver", () => {
  it("builds a value from sibling outputs, reading each once", async () => {
    const { reads, context } = fakeFacade({ latitude: 30.5, longitude: -97.7 });

    const point = await geoJsonPoint.resolve(context, () => "locate");

    expect(point).toEqual({ type: "Point", coordinates: [-97.7, 30.5] });
    expect(reads).toEqual(["latitude", "longitude"]);
  });

  it("returns null (defers) when a sibling is absent", async () => {
    const { context } = fakeFacade({ latitude: 30.5 });
    expect(await geoJsonPoint.resolve(context, () => "locate")).toBeNull();
  });
});
