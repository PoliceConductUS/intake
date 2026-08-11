import { readFile } from "node:fs/promises";
import * as shapefile from "shapefile";

/**
 * The only file in the codebase permitted to import `shapefile`. Wraps its
 * streaming reader API so the rest of the runtime can read geometry sources
 * (ESRI shapefiles and GeoJSON) without depending on the underlying
 * shapefile library directly.
 */

export interface GeoFeature {
  properties: Record<string, unknown>;
  geometry: unknown;
}

/**
 * Streams features one at a time from a shapefile (`.shp`, optionally paired
 * with a `.dbf` for attributes) so large gazetteer files don't need to be
 * held fully in memory.
 */
export async function* readShapefile(
  shpPath: string,
  dbfPath?: string,
): AsyncIterable<GeoFeature> {
  const source = await shapefile.open(shpPath, dbfPath);
  for (;;) {
    const { done, value } = await source.read();
    if (done) return;
    yield {
      properties: (value.properties ?? {}) as Record<string, unknown>,
      geometry: value.geometry,
    };
  }
}

/**
 * Reads every feature from a GeoJSON file. A bare Feature or geometry
 * (rather than a FeatureCollection) is wrapped as a single-feature array.
 */
export async function readGeoJson(path: string): Promise<GeoFeature[]> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as {
    type?: string;
    features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }>;
    properties?: Record<string, unknown>;
    geometry?: unknown;
  };

  if (parsed.type === "FeatureCollection") {
    return (parsed.features ?? []).map((feature) => ({
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    }));
  }

  if (parsed.type === "Feature") {
    return [
      {
        properties: parsed.properties ?? {},
        geometry: parsed.geometry,
      },
    ];
  }

  // Bare geometry object.
  return [{ properties: {}, geometry: parsed }];
}
