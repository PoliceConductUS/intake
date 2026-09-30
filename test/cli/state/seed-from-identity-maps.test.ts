import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seedLedgerFromIdentityMaps } from "../../../src/cli/state/source-name-to-canonical-id/seed-from-identity-maps.js";
import { createSourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

let identityDir: string;
let rootDir: string;

beforeEach(async () => {
  identityDir = await mkdtemp(path.join(tmpdir(), "tcole-identity-"));
  rootDir = await mkdtemp(path.join(tmpdir(), "tcole-workspace-"));
  await mkdir(identityDir, { recursive: true });

  await writeFile(
    path.join(identityDir, "agencies.yaml"),
    [
      "id_field: DEPARTMENT_NUMBER",
      "mappings:",
      "  '101100': cm76agency1",
      "  103070: cm76agency2",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(identityDir, "personnel.yaml"),
    [
      "id_field: PUBLIC_GUID",
      "mappings:",
      "  '1000033': cm7person1",
      "  1000038: cm7person2",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(identityDir, "agency-officers.yaml"),
    [
      "id_field: 'synthetic:PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE'",
      "mappings:",
      "  '1000033|471100|Jailer|Temporary Jailer License|2024-10-15|': cm7ao1",
      "  '1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30': cm7ao2",
    ].join("\n"),
    "utf8",
  );
});

afterEach(async () => {
  await rm(identityDir, { recursive: true, force: true });
  await rm(rootDir, { recursive: true, force: true });
});

describe("seedLedgerFromIdentityMaps", () => {
  it("seeds the ledger and round-trips through point reads", async () => {
    const counts = await seedLedgerFromIdentityMaps(
      "gov.tx.tcole",
      identityDir,
      { rootDir },
    );
    expect(counts).toEqual({ agencies: 2, personnel: 2, agencyPersonnel: 2 });

    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
    // read matches on (namespace, kind, sourceName): a hit both confirms the id
    // and that the record was written under the correct entity kind.
    // numeric-looking keys are preserved as strings
    expect(await ledger.read("gov.tx.tcole", "Agency", "101100")).toBe(
      "cm76agency1",
    );
    expect(await ledger.read("gov.tx.tcole", "Agency", "103070")).toBe(
      "cm76agency2",
    );
    expect(await ledger.read("gov.tx.tcole", "Personnel", "1000033")).toBe(
      "cm7person1",
    );
    expect(await ledger.read("gov.tx.tcole", "Personnel", "1000038")).toBe(
      "cm7person2",
    );
    // the piped synthetic tuple survives round-trip as the ledger key
    expect(
      await ledger.read(
        "gov.tx.tcole",
        "AgencyPersonnel",
        "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|",
      ),
    ).toBe("cm7ao1");
    expect(
      await ledger.read(
        "gov.tx.tcole",
        "AgencyPersonnel",
        "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30",
      ),
    ).toBe("cm7ao2");
  });
});
