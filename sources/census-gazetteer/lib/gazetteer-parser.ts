import type { ZodError } from "zod";
import {
  type GazetteerAdministrativeAreaRecord,
  gazetteerAdministrativeAreaRecordSchema,
  type GazetteerPlaceRecord,
  gazetteerPlaceRecordSchema,
  type GazetteerStateRecord,
  gazetteerStateRecordSchema,
} from "./schemas.js";

/**
 * Ported from `intake.census-gazetteer/src/gazetteer-parser.js`
 * (`parseGazetteerFile` + `requiredColumnsByType`). `writeNormalizedRecordsArtifact`
 * from the original file was standalone-producer plumbing and was dropped.
 *
 * Rewire: the original read the file itself (`readFile(filePath, "utf8")`).
 * Here the caller reads the pipe-delimited `.txt` entry out of the source zip
 * (via the Phase-1 `readZipEntryText`) and passes the text directly, so this
 * function no longer performs I/O and no longer has a file path to include in
 * error messages.
 */

export type GazetteerRecordType = "state" | "administrative_area" | "place";

export type GazetteerRecordByType = {
  state: GazetteerStateRecord;
  administrative_area: GazetteerAdministrativeAreaRecord;
  place: GazetteerPlaceRecord;
};

const baseRequiredColumns = [
  "USPS",
  "GEOID",
  "NAME",
  "ALAND",
  "AWATER",
  "INTPTLAT",
  "INTPTLONG",
];

export const requiredColumnsByType: Record<GazetteerRecordType, string[]> = {
  state: baseRequiredColumns,
  administrative_area: [
    ...baseRequiredColumns.slice(0, 2),
    "ANSICODE",
    ...baseRequiredColumns.slice(2),
  ],
  place: [
    ...baseRequiredColumns.slice(0, 2),
    "ANSICODE",
    ...baseRequiredColumns.slice(2),
  ],
};

const schemasByType = {
  state: gazetteerStateRecordSchema,
  administrative_area: gazetteerAdministrativeAreaRecordSchema,
  place: gazetteerPlaceRecordSchema,
};

export function parseGazetteerFile<T extends GazetteerRecordType>(
  text: string,
  type: T,
): GazetteerRecordByType[T][] {
  const schema = schemasByType[type];
  if (schema === undefined) {
    throw new Error(`Unsupported Gazetteer record type: ${type}`);
  }

  const lines = text.trimEnd().split(/\r?\n/);
  const header = lines[0]?.split("|") ?? [];
  const requiredColumns = requiredColumnsByType[type];
  const missingColumns = requiredColumns.filter(
    (columnName) => !header.includes(columnName),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `Invalid Gazetteer header: missing ${missingColumns.join(", ")}`,
    );
  }

  return lines
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const values = line.split("|");
      const parsedRecord = Object.fromEntries(
        header.map((columnName, columnIndex) => [
          columnName,
          values[columnIndex] ?? "",
        ]),
      );
      const record = Object.fromEntries(
        requiredColumns.map((columnName) => [
          columnName,
          parsedRecord[columnName],
        ]),
      );
      const result = schema.safeParse(record);
      if (!result.success) {
        throw new Error(
          `Invalid Gazetteer ${typeLabel(type)} record at record ${
            index + 1
          }: ${formatZodIssues(result.error)}`,
        );
      }

      return result.data as GazetteerRecordByType[T];
    });
}

function typeLabel(type: GazetteerRecordType): string {
  return type.replaceAll("_", " ");
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join(".") || "<root>";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
}
