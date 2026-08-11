import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readGeoJson, readShapefile } from "../../../../src/cli/run/parse/geo.js";

const geojsonFixture = fileURLToPath(
  new URL("../../../fixtures/gazetteer/sample.geojson", import.meta.url),
);
const shpFixture = fileURLToPath(
  new URL("../../../fixtures/gazetteer/sample.shp", import.meta.url),
);

const EXPECTED_PROPERTIES = { GEOID: "04", NAME: "Arizona" };

describe("readGeoJson", () => {
  it("reads features with properties and geometry", async () => {
    const features = await readGeoJson(geojsonFixture);
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toEqual(EXPECTED_PROPERTIES);
    expect((features[0]?.geometry as { type: string }).type).toBe("Polygon");
  });

  it("is deterministic across repeated calls", async () => {
    const first = await readGeoJson(geojsonFixture);
    const second = await readGeoJson(geojsonFixture);
    expect(second).toEqual(first);
  });
});

describe("readShapefile", () => {
  it("streams features with properties and geometry", async () => {
    const collected: Array<{
      properties: Record<string, unknown>;
      geometry: unknown;
    }> = [];
    for await (const feature of readShapefile(shpFixture)) {
      collected.push(feature);
    }
    expect(collected).toHaveLength(1);
    expect(collected[0]?.properties).toEqual(EXPECTED_PROPERTIES);
    expect((collected[0]?.geometry as { type: string }).type).toBe("Polygon");
  });

  it("is deterministic across repeated iterations", async () => {
    const first: unknown[] = [];
    for await (const feature of readShapefile(shpFixture)) {
      first.push(feature);
    }
    const second: unknown[] = [];
    for await (const feature of readShapefile(shpFixture)) {
      second.push(feature);
    }
    expect(second).toEqual(first);
  });
});
