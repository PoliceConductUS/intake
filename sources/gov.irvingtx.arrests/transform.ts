import { BeatBoundariesSchema } from "./beats.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  SourceManifest,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import {
  buildProfile,
  parseNormalizedArrest,
  type NormalizedArrest,
} from "./arrest.js";

export const produces: readonly ImportArtifactKind[] = [
  "ArrestProfiles",
  "AgencyArrestProfiles",
];

// The per-officer summary resolves names against the imported roster, so it must
// run after AgencyPersonnel is applied. That ordering falls out of the FK
// dependency (ArrestProfile → agency_personnel, ADR 0021/0032) — no standalone flag.
// Its input is a local-only, PII-bearing acquire output, so an update that has not
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
    .map((line) => parseNormalizedArrest(JSON.parse(line)));

  const provenanceFile = paths.find((candidate) =>
    candidate.endsWith("analytics-provenance.json"),
  );
  if (provenanceFile === undefined)
    throw new Error("Missing analytics-provenance.json (run acquire first).");
  const evidence = z
    .object({
      beatBoundaries: BeatBoundariesSchema,
      provenance: z.record(z.string(), z.unknown()),
      audit: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(JSON.parse(await readFile(provenanceFile, "utf8")));
  // Validate uniqueness even if a duplicate booking has no resolvable officer.
  const agencyProfile = buildProfile(arrests);
  const beatCodes = new Set(evidence.beatBoundaries.map((beat) => beat.code));
  for (const arrest of arrests) {
    if (
      arrest.enrichment.beat !== null &&
      !beatCodes.has(arrest.enrichment.beat)
    )
      throw new Error(
        `Missing patrol boundary for beat ${arrest.enrichment.beat}`,
      );
  }
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

  // Agency coverage includes every booking; officer coverage includes each booking
  // once for each resolved assignment.
  const byOfficer = new Map<string, NormalizedArrest[]>();
  const unresolvedNames = new Set<string>();
  let arrestsWithNoOfficer = 0;
  for (const arrest of arrests) {
    let linked = false;
    const assignments = new Set<string>();
    for (const name of arrest.officerNames) {
      const officerId = officerByName.get(name) ?? null;
      if (officerId === null) {
        unresolvedNames.add(name);
        continue;
      }
      linked = true;
      if (assignments.has(officerId)) continue;
      assignments.add(officerId);
      const list = byOfficer.get(officerId);
      if (list === undefined) byOfficer.set(officerId, [arrest]);
      else list.push(arrest);
    }
    if (!linked) arrestsWithNoOfficer += 1;
  }

  const records: EmittedRecords = {};
  for (const [officerId, officerArrests] of byOfficer) {
    const profile = buildProfile(officerArrests);
    records[officerId] = {
      spec: structuredClone({
        agency_personnel_id: officerId,
        coverage: {
          source: "gov.irvingtx.arrests",
          agency: AGENCY_NAME,
          ...profile.coverage,
          provenance: evidence.provenance,
        },
        breakdowns: profile.breakdowns,
      }),
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

  return {
    artifacts: [
      { kind: "ArrestProfiles", records },
      {
        kind: "AgencyArrestProfiles",
        records: {
          [agency.agencyId]: {
            spec: {
              agency_id: agency.agencyId,
              coverage: {
                source: "gov.irvingtx.arrests",
                agency: AGENCY_NAME,
                ...agencyProfile.coverage,
                provenance: evidence.provenance,
                audit: evidence.audit,
                dataQualityFindings: [
                  {
                    code: "bookings_without_matching_charge_records",
                    count: agencyProfile.coverage.arrestsWithoutLinkedCharges,
                    totalBookings: agencyProfile.coverage.totalArrests,
                    reason: "unknown",
                  },
                ],
                officersProfiled: byOfficer.size,
                unresolvedNameCount: unresolvedNames.size,
                arrestsWithNoResolvedOfficer: arrestsWithNoOfficer,
              },
              breakdowns: {
                ...agencyProfile.breakdowns,
                arrest_beat_boundaries: evidence.beatBoundaries,
              },
            },
          },
        },
      },
    ],
  };
};
