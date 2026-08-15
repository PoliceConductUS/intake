import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seedLedgerFromIdentityMaps } from "../../../src/cli/state/source-name-to-canonical-id/seed-from-identity-maps.js";
import { loadSourceNameToCanonicalIds } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

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
  it("seeds the ledger and round-trips through loadSourceNameToCanonicalIds", async () => {
    const counts = await seedLedgerFromIdentityMaps(
      "gov.tx.tcole",
      identityDir,
      { rootDir },
    );
    expect(counts).toEqual({ agencies: 2, personnel: 2, agencyPersonnel: 2 });

    const loaded = await loadSourceNameToCanonicalIds("gov.tx.tcole", {
      rootDir,
    });

    // numeric-looking keys are preserved as strings
    expect(loaded.agencies["101100"].canonicalId).toBe("cm76agency1");
    expect(loaded.agencies["103070"].canonicalId).toBe("cm76agency2");
    expect(loaded.personnel["1000033"].canonicalId).toBe("cm7person1");
    expect(loaded.personnel["1000038"].canonicalId).toBe("cm7person2");
    // the piped synthetic tuple survives round-trip as the ledger key
    expect(
      loaded.agencyPersonnel[
        "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|"
      ].canonicalId,
    ).toBe("cm7ao1");
    expect(
      loaded.agencyPersonnel[
        "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30"
      ].canonicalId,
    ).toBe("cm7ao2");

    // kinds are stamped correctly
    expect(loaded.agencies["101100"].kind).toBe("Agency");
    expect(loaded.personnel["1000033"].kind).toBe("Personnel");
    expect(
      loaded.agencyPersonnel[
        "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|"
      ].kind,
    ).toBe("AgencyPersonnel");
  });
});
