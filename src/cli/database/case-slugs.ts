import { CaseUrlHistory } from "../../shared/io/CaseUrlHistory.js";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { caseCitation, caseCitationSlug } from "../../shared/case-citation.js";
import {
  CaseSlugMigration,
  caseSlugRowSchema,
  type CaseSlugRow,
  type CaseSlugMigrationEnvelope,
} from "../../shared/io/CaseSlugMigration.js";
import { INTAKE_API_VERSION } from "../../shared/io/intake-api-version.js";
import { ResolvedProperty } from "../state/resolved-property/ResolvedProperty.js";
import {
  inspectResolvedProperty,
  resolvedPropertyCacheName,
} from "../state/resolved-property/index.js";
import {
  PropertyCorrection,
  correctionValue,
} from "../../shared/io/PropertyCorrection.js";
import { inspectPropertyCorrection } from "../../shared/io/property-corrections.js";
import { createSourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";
import { rowsFromResult, type DatabaseClient } from "./index.js";

const selection = `select c.id,c.title,c.cause_number,c.primary_source_url,c.court,c.filed_date::text,c.full_citation,c.citation_source_url,c.slug,split_part(lp.path,'/',2) as state from public.civil_cases c join public.location_path lp on lp.location_path_id=c.location_path_id order by c.id`;
const cacheKey = (id: string, rootDir: string) => ({
  rootDir,
  subject: {
    apiVersion: INTAKE_API_VERSION as typeof INTAKE_API_VERSION,
    kind: "CivilCase",
    name: id,
  },
  targetProperty: "slug",
});
export function planCaseSlugRows(rows: CaseSlugRow[]) {
  const owners = new Map<string, string>();
  for (const row of rows) {
    if (owners.has(row.slug))
      throw new Error(`Existing slug collision: ${row.slug}`);
    owners.set(row.slug, row.id);
  }
  const newOwners = new Map<string, string>();
  return rows.map((before) => {
    const newSlug = caseCitationSlug(before);
    if (newOwners.has(newSlug))
      throw new Error(`Citation slug collision: ${newSlug}`);
    if (owners.has(newSlug) && owners.get(newSlug) !== before.id)
      throw new Error(`URL already owned by another case: ${newSlug}`);
    newOwners.set(newSlug, before.id);
    return {
      id: before.id,
      before,
      newSlug,
      citation: caseCitation(before),
      oldPaths:
        before.slug === newSlug
          ? []
          : [
              `/civil-cases/${before.slug}/`,
              `/civil-litigation/${before.state}/${before.slug}/`,
            ],
    };
  });
}

export async function prepareCaseSlugMigration(
  client: DatabaseClient,
  rootDir: string,
  evidence: string,
): Promise<CaseSlugMigrationEnvelope> {
  const rows = rowsFromResult(await client.query(selection)).map((r) =>
    caseSlugRowSchema.parse(r),
  );
  const count = rowsFromResult(
    await client.query("select count(*)::integer as n from public.civil_cases"),
  )[0]?.n;
  if (rows.length !== count)
    throw new Error(
      "Some cases have no location; cannot preserve every old URL.",
    );
  const changes = planCaseSlugRows(rows);
  const history = await readCaseUrlHistory(rootDir);
  for (const alias of history?.spec.aliases ?? []) {
    const row = changes.find((r) => r.id === alias.caseId);
    if (!row)
      throw new Error(
        `Retained historical URL has no case in rebuild: ${alias.oldPath}`,
      );
    if (alias.oldPath === `/civil-cases/${row.newSlug}/`)
      throw new Error(`Citation slug reuses a retired URL: ${alias.oldPath}`);
    row.oldPaths.push(alias.oldPath);
  }
  const recordedAt = new Date().toISOString();
  const commandId = "case-citation-slugs-v1";
  const planned: CaseSlugMigrationEnvelope["spec"]["rows"] = [];
  for (const row of changes) {
    const key = cacheKey(row.id, rootDir);
    const cacheBefore = (await inspectResolvedProperty(key)) ?? null;
    const entries = cacheBefore?.spec.entries ?? [];
    const active = entries.find((e) => e.inputFingerprint === undefined);
    if (active !== undefined && active.value !== row.before.slug)
      throw new Error(`Cache/database slug conflict for ${row.id}`);
    // Earlier canonical cache values are retained URL ownership evidence.
    for (const entry of entries) {
      if (typeof entry.value !== "string" || !/^[a-z0-9-]+$/.test(entry.value))
        throw new Error(`Invalid historical slug for ${row.id}`);
      if (entry.value !== row.newSlug)
        row.oldPaths.push(
          `/civil-cases/${entry.value}/`,
          `/civil-litigation/${row.before.state}/${entry.value}/`,
        );
    }
    const cacheAfter = ResolvedProperty.new({
      metadata: cacheBefore?.metadata ?? {
        name: resolvedPropertyCacheName(key),
        namespace: "intake",
      },
      spec: {
        subject: key.subject,
        targetProperty: "slug",
        entries: [
          ...entries.map((e, i) => ({
            ...e,
            inputFingerprint:
              e.inputFingerprint ?? `citation-migration-previous-${i}`,
          })),
          {
            value: row.newSlug,
            commandId,
            recordedAt,
            sources: active?.sources ?? {},
          },
        ],
      },
    });
    planned.push({
      ...row,
      oldPaths: [...new Set(row.oldPaths)].sort(),
      cacheBefore,
      cacheAfter,
    });
  }
  const corrections: CaseSlugMigrationEnvelope["spec"]["corrections"] = [];
  const nsRoot = path.join(rootDir, "state", "intake", "namespaces");
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  for (const namespace of await readdir(nsRoot)) {
    const dir = path.join(nsRoot, namespace, "PropertyCorrection");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    for (const file of files) {
      const before = await PropertyCorrection.read(path.join(dir, file), {
        getLocationPathById: async (id) => {
          const row = rowsFromResult(
            await client.query(
              "select location_path_id,level from public.location_path where location_path_id=$1",
              [id],
            ),
          )[0];
          return row
            ? {
                location_path_id: String(row.location_path_id),
                level: String(row.level),
              }
            : undefined;
        },
      });
      if (
        before.spec.subject.kind !== "CivilCase" ||
        before.spec.targetProperty !== "slug"
      )
        continue;
      const id = await ledger.read(
        before.metadata.namespace,
        "CivilCase",
        before.spec.subject.name,
      );
      const row = planned.find((r) => r.id === id);
      if (!row)
        throw new Error(
          `Slug correction has no case in migration: ${before.spec.subject.name}`,
        );
      const active = before.spec.entries.find(
        (e) => e.inputFingerprint === undefined,
      )!;
      if (correctionValue(active) !== row.before.slug)
        throw new Error(`Correction/database slug conflict: ${id}`);
      const after = PropertyCorrection.new({
        ...before,
        spec: {
          ...before.spec,
          entries: [
            ...before.spec.entries.map((e, i) => ({
              ...e,
              inputFingerprint:
                e.inputFingerprint ?? `citation-migration-previous-${i}`,
            })),
            { from: active.from, value: row.newSlug, commandId, recordedAt },
          ],
        },
      });
      corrections.push({ before, after });
    }
  }
  return CaseSlugMigration.new({
    metadata: { name: commandId, namespace: "intake" },
    spec: {
      policy: "indigo-full-or-labelled-docket-v1",
      evidence,
      recordedAt,
      rows: planned,
      corrections,
    },
  });
}

export async function assertCaseSlugState(
  event: CaseSlugMigrationEnvelope,
  rootDir: string,
  complete = false,
): Promise<void> {
  for (const row of event.spec.rows) {
    const current =
      (await inspectResolvedProperty(cacheKey(row.id, rootDir))) ?? null;
    if (
      !isDeepStrictEqual(current, row.cacheAfter) &&
      (complete || !isDeepStrictEqual(current, row.cacheBefore))
    )
      throw new Error(`Slug cache drift for ${row.id}`);
  }
  if (complete) {
    const history = await readCaseUrlHistory(rootDir);
    const aliases = new Map(
      history?.spec.aliases.map((a) => [a.oldPath, a.caseId]) ?? [],
    );
    for (const row of event.spec.rows)
      for (const oldPath of row.oldPaths)
        if (aliases.get(oldPath) !== row.id)
          throw new Error(`Missing retained URL history: ${oldPath}`);
  }
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  for (const change of event.spec.corrections) {
    const b = change.before;
    const id = await ledger.read(
      b.metadata.namespace,
      "CivilCase",
      b.spec.subject.name,
    );
    const row = event.spec.rows.find((r) => r.id === id);
    const active = change.after.spec.entries.find(
      (e) => e.inputFingerprint === undefined,
    )!;
    if (!row || correctionValue(active) !== row.newSlug)
      throw new Error(
        `Slug correction does not match canonical case: ${b.spec.subject.name}`,
      );
    const current = await inspectPropertyCorrection(
      rootDir,
      b.metadata.namespace,
      b.spec.subject.kind,
      b.spec.subject.name,
      b.spec.targetProperty,
    );
    if (
      !isDeepStrictEqual(current, change.after) &&
      (complete || !isDeepStrictEqual(current, b))
    )
      throw new Error(`Slug correction drift for ${b.spec.subject.name}`);
  }
}

export async function completeCaseSlugState(
  event: CaseSlugMigrationEnvelope,
  rootDir: string,
): Promise<void> {
  await assertCaseSlugState(event, rootDir);
  for (const row of event.spec.rows) {
    await ResolvedProperty.write(
      path.join(
        rootDir,
        "state",
        "intake",
        "namespaces",
        "intake",
        "ResolvedProperty",
      ),
      row.cacheAfter,
    );
  }
  for (const change of event.spec.corrections) {
    await PropertyCorrection.write(
      path.join(
        rootDir,
        "state",
        "intake",
        "namespaces",
        encodeURIComponent(change.after.metadata.namespace),
        "PropertyCorrection",
      ),
      change.after,
    );
  }
  await persistCaseUrlHistory(event, rootDir);
  await assertCaseSlugState(event, rootDir, true);
}

/** Caller owns transaction plus immutable data-chain receipt. */
export async function applyCaseSlugDatabase(
  client: DatabaseClient,
  event: CaseSlugMigrationEnvelope,
): Promise<number> {
  await client.query(
    "lock table public.civil_cases, public.civil_case_url_alias in share row exclusive mode",
  );
  const actual = rowsFromResult(await client.query(selection)).map((r) =>
    caseSlugRowSchema.parse(r),
  );
  const expected = event.spec.rows.map((r) => r.before);
  if (!isDeepStrictEqual(actual, expected))
    throw new Error("Case citation inputs changed since migration planning.");
  const owners = new Map<string, string>();
  for (const row of event.spec.rows) {
    if (
      row.id !== row.before.id ||
      row.newSlug !== caseCitationSlug(row.before)
    )
      throw new Error("Invalid migration identity or citation slug.");
    owners.set(`/civil-cases/${row.newSlug}/`, row.id);
    owners.set(`/civil-litigation/${row.before.state}/${row.newSlug}/`, row.id);
  }
  for (const alias of rowsFromResult(
    await client.query(
      "select old_path,civil_case_id from public.civil_case_url_alias",
    ),
  )) {
    const owner = owners.get(String(alias.old_path));
    if (owner && owner !== alias.civil_case_id)
      throw new Error(`Historical URL collision: ${alias.old_path}`);
    owners.set(String(alias.old_path), String(alias.civil_case_id));
  }
  for (const row of event.spec.rows) {
    for (const oldPath of row.oldPaths) {
      const owner = owners.get(oldPath);
      if (owner && owner !== row.id)
        throw new Error(`Historical URL collision: ${oldPath}`);
      owners.set(oldPath, row.id);
    }
  }
  for (const row of event.spec.rows) {
    if (row.before.slug !== row.newSlug) {
      const changed = rowsFromResult(
        await client.query(
          "update public.civil_cases set slug=$1 where id=$2 and slug=$3 returning id",
          [row.newSlug, row.id, row.before.slug],
        ),
      );
      if (changed.length !== 1)
        throw new Error(`Case slug update failed: ${row.id}`);
    }
    for (const oldPath of row.oldPaths) {
      const existing = rowsFromResult(
        await client.query(
          "select civil_case_id from public.civil_case_url_alias where old_path=$1",
          [oldPath],
        ),
      );
      if (!existing.length)
        await client.query(
          "insert into public.civil_case_url_alias (old_path,civil_case_id,evidence,recorded_at) values ($1,$2,$3,$4)",
          [oldPath, row.id, event.spec.evidence, event.spec.recordedAt],
        );
    }
  }
  return event.spec.rows.filter((r) => r.before.slug !== r.newSlug).length;
}

export const readCaseUrlHistory = (rootDir: string) =>
  CaseUrlHistory.readDirectory(
    path.join(
      rootDir,
      "state",
      "intake",
      "namespaces",
      "intake",
      "CaseUrlHistory",
    ),
  );

async function persistCaseUrlHistory(
  event: CaseSlugMigrationEnvelope,
  rootDir: string,
) {
  const history = (await readCaseUrlHistory(rootDir)) ?? CaseUrlHistory.new([]);
  const aliases = new Map(history.spec.aliases.map((a) => [a.oldPath, a]));
  for (const row of event.spec.rows)
    for (const oldPath of row.oldPaths) {
      const old = aliases.get(oldPath);
      if (old && old.caseId !== row.id)
        throw new Error(`Historical case URL ownership conflict: ${oldPath}`);
      if (!old)
        aliases.set(oldPath, {
          oldPath,
          caseId: row.id,
          evidence: event.spec.evidence,
          recordedAt: event.spec.recordedAt,
        });
    }
  await CaseUrlHistory.write(
    path.join(
      rootDir,
      "state",
      "intake",
      "namespaces",
      "intake",
      "CaseUrlHistory",
    ),
    CaseUrlHistory.new(
      [...aliases.values()].sort((a, b) => a.oldPath.localeCompare(b.oldPath)),
    ),
  );
}
