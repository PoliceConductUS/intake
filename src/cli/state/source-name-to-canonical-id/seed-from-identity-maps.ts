import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  persistSourceNameToCanonicalIds,
  type SourceNameToCanonicalIds,
} from "./index.js";

type IdentityMapFile = {
  id_field?: string;
  mappings?: Record<string, unknown>;
};

/**
 * Reads one external identity map file (`{ id_field, mappings: { sourceKey:
 * canonicalId } }`). YAML may parse purely-numeric keys/values as numbers, so
 * both are coerced back to strings.
 */
async function readIdentityMap(
  filePath: string,
): Promise<Record<string, string>> {
  const parsed = parse(await readFile(filePath, "utf8")) as
    | IdentityMapFile
    | null
    | undefined;
  const mappings = parsed?.mappings ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(mappings)) {
    const canonicalId = String(value).trim();
    if (canonicalId === "") continue;
    out[String(key)] = canonicalId;
  }
  return out;
}

export type SeedLedgerCounts = {
  agencies: number;
  personnel: number;
  agencyPersonnel: number;
};

/**
 * Seeds the SourceNameToCanonicalId ledger for `namespace` from a directory of
 * external identity maps — `agencies.yaml` (keyed by TCOLE `DEPARTMENT_NUMBER`),
 * `personnel.yaml` (keyed by `PUBLIC_GUID`), and `agency-officers.yaml` (keyed by
 * the service tuple). Pre-seeding lets a reconstruction reuse existing canonical
 * IDs (from `seed.sql`) instead of minting new ones. Existing ledger records for
 * the same keys are overwritten. Reuses `persistSourceNameToCanonicalIds` so
 * record naming/encoding matches what the loader reads.
 */
export async function seedLedgerFromIdentityMaps(
  namespace: string,
  identityDir: string,
  options: { rootDir?: string } = {},
): Promise<SeedLedgerCounts> {
  const agencyIds = await readIdentityMap(
    path.join(identityDir, "agencies.yaml"),
  );
  const personnelIds = await readIdentityMap(
    path.join(identityDir, "personnel.yaml"),
  );
  const agencyPersonnelIds = await readIdentityMap(
    path.join(identityDir, "agency-officers.yaml"),
  );

  const mappings: SourceNameToCanonicalIds = {
    locationPaths: {},
    agencies: Object.fromEntries(
      Object.entries(agencyIds).map(([name, canonicalId]) => [
        name,
        { kind: "Agency", canonicalId },
      ]),
    ),
    personnel: Object.fromEntries(
      Object.entries(personnelIds).map(([name, canonicalId]) => [
        name,
        { kind: "Personnel", canonicalId },
      ]),
    ),
    agencyPersonnel: Object.fromEntries(
      Object.entries(agencyPersonnelIds).map(([name, canonicalId]) => [
        name,
        { kind: "AgencyPersonnel", canonicalId },
      ]),
    ),
  };

  await persistSourceNameToCanonicalIds(namespace, mappings, options);

  return {
    agencies: Object.keys(agencyIds).length,
    personnel: Object.keys(personnelIds).length,
    agencyPersonnel: Object.keys(agencyPersonnelIds).length,
  };
}
