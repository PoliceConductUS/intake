import {
  deterministicTotalAreaOverlapRecordSchema,
  type DeterministicTotalAreaOverlapRecord,
} from "./schemas.js";

/**
 * Ported from `intake.census-gazetteer/src/hierarchy-parser.js`
 * (`parseHierarchyRelationshipFile`). Pipe-delimited header aliasing and
 * per-row Zod validation are unchanged from the original; only the I/O edge
 * was rewired:
 *
 * The original read the relationship file itself
 * (`readFile(filePath, "utf8")`). The port accepts the already-read file
 * **text** directly — the caller reads it (e.g. via a zip-entry or plain
 * file read) — so this module stays pure.
 *
 * The produced record shape is the same
 * `deterministicTotalAreaOverlapRecordSchema` shape the TIGER path
 * (`tiger-hierarchy.ts`) produces, so both feed `buildLocationPaths`
 * identically.
 */

export function parseHierarchyRelationshipFile(
  text: string,
  selectedYear: string | number,
): DeterministicTotalAreaOverlapRecord[] {
  const lines = text.trimEnd().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Hierarchy relationship file is empty");
  }

  const headers = lines[0]!.split("|");
  const records: DeterministicTotalAreaOverlapRecord[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const values = line.split("|");
    const row: Record<string, string> = Object.fromEntries(
      headers.map((header, valueIndex) => [header, values[valueIndex] ?? ""]),
    );
    const stateGeoid = firstPresent(row, ["stateGeoid", "STATEFP", "STATE"]);
    const administrativeAreaGeoid = firstPresent(row, [
      "administrativeAreaGeoid",
      "COUNTYGEOID",
      "COUNTY_GEOID",
      "GEOID_COUNTY",
    ]);
    const placeGeoid = firstPresent(row, [
      "placeGeoid",
      "PLACEGEOID",
      "PLACE_GEOID",
      "GEOID_PLACE",
    ]);
    const overlapTotalArea = Number(
      firstPresent(row, ["overlapTotalArea", "AREALAND", "AREAPT", "AREA"]) ?? 1,
    );

    const result = deterministicTotalAreaOverlapRecordSchema.safeParse({
      stateGeoid,
      administrativeAreaGeoid,
      placeGeoid,
      overlapTotalArea,
      placeName: firstPresent(row, ["placeName", "PLACE_NAME", "NAME_PLACE"]),
      placeLabel: firstPresent(row, [
        "placeLabel",
        "PLACE_LABEL",
        "NAMELSAD",
        "NAMELSAD_PLACE",
      ]),
      sourceKey:
        row.sourceKey ??
        `us-census-relationship:${selectedYear}:${stateGeoid}:${administrativeAreaGeoid}:${placeGeoid}`,
    });
    if (!result.success) {
      const issue = result.error.issues
        .map((error) => `${error.path.join(".")}: ${error.message}`)
        .join("; ");
      throw new Error(
        `Invalid hierarchy relationship record at record ${index + 1}: ${issue}`,
      );
    }
    records.push(result.data);
  }

  if (records.length === 0) {
    throw new Error("No authoritative Census hierarchy source was acquired");
  }

  return records;
}

function firstPresent(
  row: Record<string, string>,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    if (row[field] !== undefined && row[field] !== "") return row[field];
  }
  return undefined;
}
