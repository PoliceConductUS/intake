import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

/**
 * One entry from a source's `excluded.yaml`: a record the import is allowed
 * to drop instead of failing loud, because someone has documented why it has
 * no usable location/identity.
 */
export type ExcludedRecord = {
  kind: string;
  key: string;
  name?: string;
  reason: string;
};

/**
 * All of a source's excluded records, keyed by `excludedRecordKey(kind,
 * key)`. The key is deliberately `(kind, sourceKey)` rather than
 * `(kind, canonicalId)` so exclusions can be authored against the source's
 * own identifiers (e.g. a TCOLE `DEPARTMENT_NUMBER`) before canonical IDs
 * exist.
 */
export type ExcludedRecords = ReadonlyMap<string, ExcludedRecord>;

export function excludedRecordKey(kind: string, sourceKey: string): string {
  return `${kind}:${sourceKey}`;
}

type ExcludedRecordsFile = {
  excluded?: unknown;
};

function requiredStringField(
  filePath: string,
  index: number,
  entry: Record<string, unknown>,
  field: string,
): string {
  const value = entry[field];
  const text =
    value === undefined || value === null ? "" : String(value).trim();
  if (text === "") {
    throw new Error(
      `${filePath}: excluded[${index}] requires a non-empty ${field}.`,
    );
  }
  return text;
}

function optionalStringField(
  entry: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = entry[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/**
 * Reads a source's `excluded.yaml` (if present) into a set of records keyed
 * by `(kind, sourceKey)`, each carrying the documented reason it is exempt
 * from the import's fail-loud-on-unresolvable rule. A source with no
 * `excluded.yaml` yields an empty set, so every unresolvable record in that
 * source aborts the import.
 */
export async function loadExcludedRecords(
  sourceDir: string,
): Promise<ExcludedRecords> {
  const filePath = path.join(sourceDir, "excluded.yaml");
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  let parsed: ExcludedRecordsFile;
  try {
    parsed = (parse(contents) ?? {}) as ExcludedRecordsFile;
  } catch (error) {
    const message = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`${filePath} is malformed${message}`);
  }

  const entries = Array.isArray(parsed.excluded) ? parsed.excluded : [];
  const records = new Map<string, ExcludedRecord>();
  entries.forEach((rawEntry, index) => {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      throw new Error(
        `${filePath}: excluded[${index}] must be an object with kind, key, and reason.`,
      );
    }
    const entry = rawEntry as Record<string, unknown>;
    const kind = requiredStringField(filePath, index, entry, "kind");
    const key = requiredStringField(filePath, index, entry, "key");
    const reason = requiredStringField(filePath, index, entry, "reason");
    records.set(excludedRecordKey(kind, key), {
      kind,
      key,
      name: optionalStringField(entry, "name"),
      reason,
    });
  });

  return records;
}
