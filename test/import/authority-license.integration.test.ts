import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const describeWithDocker = dockerAvailable() ? describe : describe.skip;

// End-to-end smoke of the 3NF license model + business-key convergence: a Personnel,
// an AuthorityLicense (its type), and TWO Licenses that resolve to the SAME
// (personnel_id, authority_license_id) business key must land as ONE license row.
describeWithDocker("authority_license + license import (real Postgres)", () => {
  let db: IntakeDatabase;

  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.truncateAll();
    await db.query(
      `insert into public.location_path (location_path_id, path, level, display_name)
       values ('tx-lp', '/tx/', 'state', 'Texas')`,
    );
  });

  test("two same-business-key licenses converge to one row via find-or-mint", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "authlic-"));
    const runId = "tz4a98xxat96iws9zmbrgj3c";

    const written = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "run", namespace: "gov.tx.tcole" },
        spec: {
          artifacts: [
            {
              kind: "LicensingAuthorities",
              spec: {
                records: {
                  tcole: {
                    spec: {
                      name: "Texas Commission on Law Enforcement",
                      abbreviation: "TCOLE",
                      website: "https://www.tcole.texas.gov",
                      location_path_id: "tx",
                    },
                  },
                },
              },
            },
            {
              kind: "Personnel",
              spec: {
                records: {
                  p1: {
                    spec: {
                      first_name: "Marc",
                      last_name: "Denney",
                      middle_name: null,
                      prefix: null,
                      suffix: null,
                      slug: "marc-denney",
                    },
                  },
                },
              },
            },
            {
              kind: "AuthorityLicenses",
              spec: {
                records: {
                  "tcole|Peace Officer": {
                    spec: {
                      licensing_authority_id: "tcole",
                      name: "Peace Officer",
                    },
                  },
                },
              },
            },
            {
              kind: "Licenses",
              spec: {
                records: {
                  // Two variant source keys, one business key → one row (last-wins).
                  "p1|Peace Officer": {
                    spec: {
                      personnel_id: "p1",
                      authority_license_id: "tcole|Peace Officer",
                      status: "ACTIVE",
                      first_awarded: "1994-06-16",
                    },
                  },
                  "p1|Peace Officer License": {
                    spec: {
                      personnel_id: "p1",
                      authority_license_id: "tcole|Peace Officer",
                      status: "Active",
                      first_awarded: "1994-06-16",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );

    const result = await importArtifacts({
      artifactsPath: written.path,
      env: {
        DATABASE_URL: db.connectionString,
        INTAKE_WORKSPACE_TEST: rootDir,
      },
      logger: { info: () => {}, debug: () => {} },
      commandName: runId,
      commandDirectory: path.join(
        rootDir,
        "intake",
        "commands",
        `2026-08-27T00-00-00-000Z-${runId}`,
      ),
    });

    expect(result).toMatchObject({ ok: true });

    // Exactly one authority_license and one license (the two variants converged).
    // licensing_authority_id is the resolved LicensingAuthority canonical id.
    const authorityLicenses = await db.query(
      "select licensing_authority_id, name from public.authority_license",
    );
    expect(authorityLicenses.rows).toEqual([
      { licensing_authority_id: expect.any(String), name: "Peace Officer" },
    ]);

    const licenses = await db.query(
      `select l.personnel_id, al.name, l.status
         from public.license l
         join public.authority_license al on al.id = l.authority_license_id`,
    );
    expect(licenses.rows).toEqual([
      {
        personnel_id: expect.any(String),
        name: "Peace Officer",
        status: "Active",
      },
    ]);
  });
});
