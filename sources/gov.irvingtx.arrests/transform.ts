import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  SourceManifest,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import {
  buildBreakdowns,
  coverageOf,
  type NormalizedArrest,
} from "./arrest.js";

export const produces: readonly ImportArtifactKind[] = ["ArrestProfiles"];

// The per-officer summary resolves names against the imported roster, so it must
// run after AgencyPersonnel is applied. That ordering falls out of the FK
// dependency (ArrestProfile → agency_personnel, ADR 0021/0032) — no standalone flag.
// Its input is a local-only, PII-bearing acquire output, so a rebuild that has not
// acquired it simply skips it (it never runs unattended without the file).

const AGENCY_NAME = "Irving Police Department";

export const transform: SourceTransform = async ({
  paths,
  state,
  data,
  logger,
}): Promise<SourceManifest> => {
  if (data === undefined) {
    throw new Error(
      "gov.irvingtx.arrests: run data context (resolveAgency/resolvePersonnel) is required.",
    );
  }
  const file = paths.find((candidate) =>
    candidate.endsWith("arrests-normalized.jsonl"),
  );
  if (file === undefined) {
    throw new Error(
      "gov.irvingtx.arrests: no acquired arrests-normalized.jsonl (run acquire first).",
    );
  }
  const arrests = (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as NormalizedArrest);

  const agency = await data.resolveAgency?.({ agencyName: AGENCY_NAME });
  if (agency === undefined || agency === null) {
    throw new Error(
      `gov.irvingtx.arrests: ${AGENCY_NAME} does not resolve to an agency — import the roster first.`,
    );
  }

  // Resolve each distinct officer name once to an officer source id (or null).
  const officerByName = new Map<string, string | null>();
  for (const name of new Set(
    arrests.flatMap((arrest) => arrest.officerNames),
  )) {
    const resolved = await data.resolvePersonnel({
      agencyId: agency.agencyId,
      personnelName: name,
    });
    officerByName.set(name, resolved?.agencyPersonnelId ?? null);
  }

  // Every arrest resolves to an officer or it does not count (ADR 0032): group by
  // each resolved arresting officer.
  const byOfficer = new Map<string, NormalizedArrest[]>();
  const unresolvedNames = new Set<string>();
  let arrestsWithNoOfficer = 0;
  for (const arrest of arrests) {
    let linked = false;
    for (const name of arrest.officerNames) {
      const officerId = officerByName.get(name) ?? null;
      if (officerId === null) {
        unresolvedNames.add(name);
        continue;
      }
      linked = true;
      const list = byOfficer.get(officerId);
      if (list === undefined) byOfficer.set(officerId, [arrest]);
      else list.push(arrest);
    }
    if (!linked) arrestsWithNoOfficer += 1;
  }

  const records: EmittedRecords = {};
  for (const [officerId, officerArrests] of byOfficer) {
    records[officerId] = {
      spec: {
        agency_personnel_id: officerId,
        coverage: {
          source: "gov.irvingtx.arrests",
          agency: AGENCY_NAME,
          ...coverageOf(officerArrests),
        },
        breakdowns: buildBreakdowns(officerArrests),
      },
    };
  }

  await writeFile(
    path.join(state, "arrest-report.json"),
    JSON.stringify(
      {
        totalArrests: arrests.length,
        officersProfiled: byOfficer.size,
        unresolvedNameCount: unresolvedNames.size,
        arrestsWithNoResolvedOfficer: arrestsWithNoOfficer,
      },
      null,
      2,
    ),
    "utf8",
  );
  logger?.info(
    `gov.irvingtx.arrests: ${byOfficer.size} officer profiles from ${arrests.length} arrests; ${unresolvedNames.size} unresolved names.`,
  );

  return { artifacts: [{ kind: "ArrestProfiles", records }] };
};
