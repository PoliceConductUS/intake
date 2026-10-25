import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  artifactStem,
  type OfficerRow,
  type PostClient,
  type CollectLogger,
} from "./collect.js";
import type { AgencyIdCache } from "./agency-id-cache.js";
import type { DisciplinePerson } from "./discipline-workbooks.js";
export function requireExactLicense(
  number: string,
  rows: OfficerRow[],
): OfficerRow {
  if (rows.length !== 1 || String(rows[0].licenseNumber) !== number)
    throw new Error(
      `License ${number}: expected one exact search result, got ${rows.length}`,
    );
  const officer = rows[0];
  if (
    typeof officer.contactId !== "string" ||
    !officer.contactId.trim() ||
    typeof officer.licenseId !== "string" ||
    !officer.licenseId.trim()
  )
    throw new Error(`License ${number}: missing contactId/licenseId`);
  return officer;
}
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function save(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
export async function collectDisciplinePersonnel({
  sourceDir,
  people,
  client,
  cache,
  logger,
}: {
  sourceDir: string;
  people: DisciplinePerson[];
  client: Pick<PostClient, "searchLicense" | "fetchOfficerDetails">;
  cache: AgencyIdCache;
  logger?: CollectLogger;
}): Promise<void> {
  const officersDir = path.join(sourceDir, "officers");
  const requestsDir = path.join(sourceDir, "discipline-requests");
  await mkdir(officersDir, { recursive: true });
  await mkdir(requestsDir, { recursive: true });
  const collected: Array<DisciplinePerson & { officer: OfficerRow }> = [];
  const missingActions: Array<{ licenseNumber: string; contactId: string }> =
    [];
  const unresolvedLicenses: Array<
    DisciplinePerson & { reason: string; results: OfficerRow[] }
  > = [];
  const detailLicenses = new Map<
    string,
    Map<string, { officer: OfficerRow; sourceDetail: string }>
  >();
  async function collectPerson(
    person: DisciplinePerson,
    officer: OfficerRow,
  ): Promise<void> {
    const detailPath = path.join(
      officersDir,
      `${artifactStem(officer.licenseId!)}.detail.json`,
    );
    const completePath = path.join(
      requestsDir,
      `${person.licenseNumber}.complete.json`,
    );
    if ((await readJson(completePath)) === null) {
      const details = await client.fetchOfficerDetails([officer]);
      if (details.length !== 1 || !details[0])
        throw new Error(
          `License ${person.licenseNumber}: missing detail response`,
        );
      await save(detailPath, details[0]);
      await save(completePath, { licenseId: officer.licenseId });
    }
    const detail = await readJson<{
      disciplinaryActions?: unknown;
      licenses?: { POSTLicenseList?: OfficerRow[] };
    }>(detailPath);
    if (!detail)
      throw new Error(
        `License ${person.licenseNumber}: completed detail missing`,
      );
    const actions = detail.disciplinaryActions;
    if (
      actions === "No POST Disciplinary Actions found" ||
      (Array.isArray(actions) && actions.length === 0)
    )
      missingActions.push({
        licenseNumber: person.licenseNumber,
        contactId: officer.contactId!,
      });
    else if (!Array.isArray(actions))
      throw new Error(
        `License ${person.licenseNumber}: unexpected disciplinary actions response`,
      );
    for (const row of detail.licenses?.POSTLicenseList ?? []) {
      if (row.contactId !== officer.contactId)
        throw new Error(`License detail contact mismatch in ${detailPath}`);
      const number = String(row.licenseNumber);
      const candidates = detailLicenses.get(number) ?? new Map();
      candidates.set(`${row.contactId}:${row.licenseId}`, {
        officer: row,
        sourceDetail: path.relative(sourceDir, detailPath),
      });
      detailLicenses.set(number, candidates);
    }
    collected.push({ ...person, officer });
  }
  for (const [index, person] of people.entries()) {
    const searchPath = path.join(
      requestsDir,
      `${person.licenseNumber}.search.json`,
    );
    let rows = await readJson<OfficerRow[]>(searchPath);
    if (rows === null) {
      rows = await client.searchLicense(person.licenseNumber);
      await save(searchPath, rows);
    }
    if (rows.length === 0) {
      const resolution = await readJson<{
        officer: OfficerRow;
        sourceDetail: string;
      }>(path.join(requestsDir, `${person.licenseNumber}.resolution.json`));
      if (resolution !== null) {
        const confirmed = requireExactLicense(person.licenseNumber, [
          resolution.officer,
        ]);
        if (
          typeof resolution.sourceDetail !== "string" ||
          !resolution.sourceDetail.trim()
        )
          throw new Error(
            `License ${person.licenseNumber}: saved resolution missing source detail provenance`,
          );
        const complete = await readJson<{ licenseId: string }>(
          path.join(requestsDir, `${person.licenseNumber}.complete.json`),
        );
        if (complete !== null && complete.licenseId !== confirmed.licenseId)
          throw new Error(
            `License ${person.licenseNumber}: saved resolution/checkpoint identity mismatch`,
          );
        await collectPerson(person, confirmed);
        continue;
      }
    }
    let officer: OfficerRow;
    try {
      officer = requireExactLicense(person.licenseNumber, rows);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unresolvedLicenses.push({ ...person, reason, results: rows });
      logger?.info(
        `mn-post: unresolved discipline license ${person.licenseNumber}: ${reason}`,
      );
      continue;
    }
    await collectPerson(person, officer);
    logger?.info(
      `mn-post: discipline ${index + 1}/${people.length} license ${person.licenseNumber}`,
    );
  }
  const missingNumbers = new Set(
    unresolvedLicenses
      .filter((entry) => entry.results.length === 0)
      .map((entry) => entry.licenseNumber),
  );
  if (missingNumbers.size) {
    for (const filename of (await readdir(officersDir))
      .filter((name) => name.endsWith(".detail.json"))
      .sort()) {
      const detailPath = path.join(officersDir, filename);
      const detail = await readJson<{
        licenses?: { POSTLicenseList?: OfficerRow[] };
      }>(detailPath);
      const rows = detail?.licenses?.POSTLicenseList;
      if (
        !Array.isArray(rows) ||
        !rows.some((row) => missingNumbers.has(String(row.licenseNumber)))
      )
        continue;
      const origin = rows.filter(
        (row) =>
          typeof row.licenseId === "string" &&
          `${artifactStem(row.licenseId)}.detail.json` === filename,
      );
      if (
        origin.length !== 1 ||
        typeof origin[0].contactId !== "string" ||
        !origin[0].contactId.trim()
      )
        throw new Error(
          `Cannot verify cached license detail identity: ${filename}`,
        );
      for (const row of rows.filter((row) =>
        missingNumbers.has(String(row.licenseNumber)),
      )) {
        if (row.contactId !== origin[0].contactId)
          throw new Error(`License detail contact mismatch in ${filename}`);
        const number = String(row.licenseNumber);
        const candidates = detailLicenses.get(number) ?? new Map();
        const key = `${row.contactId}:${row.licenseId}`;
        if (!candidates.has(key))
          candidates.set(key, {
            officer: row,
            sourceDetail: path.relative(sourceDir, detailPath),
          });
        detailLicenses.set(number, candidates);
      }
    }
  }
  for (const unresolved of unresolvedLicenses.splice(0)) {
    const candidates = detailLicenses.get(unresolved.licenseNumber);
    if (
      unresolved.results.length !== 0 ||
      !candidates ||
      candidates.size !== 1
    ) {
      unresolvedLicenses.push(unresolved);
      continue;
    }
    const resolution = [...candidates.values()][0];
    let officer: OfficerRow;
    try {
      officer = requireExactLicense(unresolved.licenseNumber, [
        resolution.officer,
      ]);
    } catch (error) {
      unresolvedLicenses.push({
        ...unresolved,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await save(
      path.join(requestsDir, `${unresolved.licenseNumber}.resolution.json`),
      resolution,
    );
    const { reason: _reason, results: _results, ...person } = unresolved;
    await collectPerson(person, officer);
  }
  await save(path.join(sourceDir, "discipline-personnel.json"), {
    people: collected,
    missingActions,
  });
  await save(
    path.join(sourceDir, "discipline-unresolved-licenses.json"),
    unresolvedLicenses,
  );
  const unresolved = [];
  for (const agencyName of new Set(
    people.flatMap((person) => person.history.map((row) => row.agencyName)),
  )) {
    const result = await cache.resolve(agencyName);
    if (result.kind === "skip") unresolved.push({ agencyName, ...result });
  }
  await save(
    path.join(sourceDir, "discipline-unresolved-agencies.json"),
    unresolved,
  );
  if (unresolved.length)
    logger?.info(
      `mn-post: ${unresolved.length} unresolved history agencies; preserved in discipline-unresolved-agencies.json`,
    );
  for (const unresolved of unresolvedLicenses)
    logger?.info(
      `mn-post: retained unresolved license ${unresolved.licenseNumber} (workbook row ${unresolved.sourceRow}): ${unresolved.reason}`,
    );
  logger?.info(
    `mn-post: discipline coverage: ${people.length} input licenses; ${collected.length} resolved; ${unresolvedLicenses.length} unresolved; see discipline-unresolved-licenses.json`,
  );
}
