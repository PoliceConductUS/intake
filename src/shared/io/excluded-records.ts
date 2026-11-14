import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isMap, isSeq, parse, parseDocument } from "yaml";
import { z } from "zod";

const exclusionConditions = z
  .record(z.string(), z.json())
  .refine((value) => Object.keys(value).length > 0);

function parseConditions(value: unknown): z.infer<typeof exclusionConditions> {
  const result = exclusionConditions.safeParse(value);
  if (!result.success)
    throw new Error(
      "Exclusion when must be a nonempty JSON object of source field values.",
    );
  return result.data;
}

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
  when?: z.infer<typeof exclusionConditions>;
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
      ...(Object.hasOwn(entry, "when")
        ? { when: parseConditions(entry.when) }
        : {}),
    });
  });

  return records;
}

/** Writes an explicit exclusion, requiring an existing key for replacement. */
export async function appendExcludedRecord(
  stateDir: string,
  record: ExcludedRecord,
  options: { replace?: boolean } = {},
): Promise<string> {
  for (const field of ["kind", "key", "reason"] as const) {
    if (record[field].trim() === "")
      throw new Error(`Exclusion ${field} must not be blank.`);
  }
  if (Object.hasOwn(record, "when")) parseConditions(record.when);
  const filePath = path.join(stateDir, "excluded.yaml");
  const temporary = `${filePath}.tmp`;
  const pending = await open(temporary, "wx", 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST")
        throw new Error(`${filePath}: another exclusion write is in progress.`);
      throw error;
    },
  );
  let published = false;
  try {
    const targetMode = await stat(filePath)
      .then((target) => target.mode & 0o7777)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return 0o666 & ~process.umask();
        throw error;
      });
    const existing = (await loadExcludedRecords(stateDir)).get(
      excludedRecordKey(record.kind, record.key),
    );
    if (existing !== undefined && !options.replace)
      throw new Error(
        `Already excluded ${record.kind} ${record.key}: ${existing.reason}`,
      );
    if (existing === undefined && options.replace)
      throw new Error(
        `Cannot replace ${record.kind} ${record.key}: not excluded.`,
      );
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
    const entries = document.get("excluded");
    if (!isSeq(entries))
      throw new Error(`${filePath}: excluded must be a list.`);
    if (options.replace) {
      const index = entries.items.findIndex(
        (entry) =>
          isMap(entry) &&
          String(entry.get("kind")).trim() === record.kind &&
          String(entry.get("key")).trim() === record.key,
      );
      entries.set(index, record);
    } else {
      document.addIn(["excluded"], record);
    }
    await pending.writeFile(document.toString(), "utf8");
    await pending.chmod(targetMode);
    await pending.close();
    await rename(temporary, filePath);
    published = true;
    return filePath;
  } finally {
    await pending.close();
    if (!published) await unlink(temporary);
  }
}
