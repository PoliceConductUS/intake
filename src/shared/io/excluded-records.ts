import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isSeq, parse, parseDocument } from "yaml";

/**
 * One entry from a source's workspace `excluded.yaml`: a record the import is allowed
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
 * Reads a source's workspace `excluded.yaml` (if present) into a set of records keyed
 * by `(kind, sourceKey)`, each carrying the documented reason it is exempt
 * from the import's fail-loud-on-unresolvable rule. A source with no
 * `excluded.yaml` yields an empty set, so every unresolvable record in that
 * source aborts the import.
 */
export async function loadExcludedRecords(
  stateDir: string,
): Promise<ExcludedRecords> {
  const filePath = path.join(stateDir, "excluded.yaml");
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

/** Appends an explicit exclusion without replacing existing curation. */
export async function appendExcludedRecord(
  stateDir: string,
  record: ExcludedRecord,
): Promise<string> {
  for (const field of ["kind", "key", "reason"] as const) {
    if (record[field].trim() === "")
      throw new Error(`Exclusion ${field} must not be blank.`);
  }
  const existing = (await loadExcludedRecords(stateDir)).get(
    excludedRecordKey(record.kind, record.key),
  );
  if (existing !== undefined)
    throw new Error(
      `Already excluded ${record.kind} ${record.key}: ${existing.reason}`,
    );
  const filePath = path.join(stateDir, "excluded.yaml");
  const contents = await readFile(filePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const document = parseDocument(contents);
  if (document.errors.length > 0) throw document.errors[0];
  if (document.contents !== null && !isMap(document.contents))
    throw new Error(`${filePath}: expected an exclusion mapping.`);
  if (!document.has("excluded")) document.set("excluded", []);
  if (!isSeq(document.get("excluded")))
    throw new Error(`${filePath}: excluded must be a list.`);
  document.addIn(["excluded"], record);
  await writeFile(filePath, document.toString(), "utf8");
  return filePath;
}
