import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { transform } from "../../sources/gov.tx.tcole/transform.js";
import { excludeManifestRecords } from "../../src/cli/transform/exclude-records.js";
import { buildArtifactsEnvelope } from "../../src/cli/transform/source-transform.js";
import {
  Artifacts,
  InitialAgencyRoots,
  initialAgencyRootsDirectory,
  excludedRecordKey,
} from "../../src/shared/io/index.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const describeWithDocker = dockerAvailable() ? describe : describe.skip;
describeWithDocker("initial agency roots in the shared import pipeline", () => {
  let db: IntakeDatabase;
  let root: string;
  const roots: string[] = [];
  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 180_000);
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "initial-roots-import-"));
    roots.push(root);
    await db.truncateAll();
    // Reference rows deliberately exist before the first agency import.
    await db.query(
      "insert into public.location_path (location_path_id,path,level,display_name) values ('bootstrap-tx','/tx/','place','Texas')",
    );
    await persistSourceNameToCanonicalIds(
      "source.one",
      {
        locationPaths: {},
        agencies: {
          historical: { kind: "Agency", canonicalId: "canonical-historical" },
        },
        personnel: {},
        agencyPersonnel: {},
      },
      { rootDir: root },
    );
  });
  afterAll(async () => {
    await db?.stop();
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  async function writeRoots(namespace = "source.one") {
    return InitialAgencyRoots.write(
      initialAgencyRootsDirectory(root, namespace),
      InitialAgencyRoots.new({
        metadata: { name: "initial", namespace },
        spec: {
          agencySourceNames: [
            "historical",
            "absent",
            "invalid-removed",
            "excluded-removed",
          ],
        },
      }),
    );
  }
  async function load(useInitialAgencyRoots?: boolean) {
    const agency = (name: string) => ({
      spec: {
        name,
        state: "TX",
        city: "Austin",
        address: "1 Main St",
        zip_code: "78701",
        location_path_id: "bootstrap-tx",
        latitude: 30,
        longitude: -97,
      },
    });
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "source.one", name: "source" },
        spec: {
          artifacts: [
            {
              kind: "Agencies",
              spec: {
                records: {
                  historical: agency("Historical PD"),
                  ordinary: agency("Open PD"),
                  unlisted: agency("Unlisted PD"),
                },
              },
            },
            {
              kind: "Personnel",
              spec: {
                records: {
                  past: { spec: { first_name: "Historical" } },
                  current: { spec: { first_name: "Current" } },
                },
              },
            },
            {
              kind: "AgencyPersonnel",
              spec: {
                records: {
                  past: {
                    spec: {
                      agency_id: "historical",
                      personnel_id: "past",
                      start_date: "2000-01-01",
                      end_date: "2001-01-01",
                      title: "Officer",
                    },
                  },
                  current: {
                    spec: {
                      agency_id: "ordinary",
                      personnel_id: "current",
                      start_date: "2020-01-01",
                      end_date: null,
                      title: "Officer",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    return importArtifacts({
      artifactsPath: input.path,
      useInitialAgencyRoots,
      env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
      commandName: "bootstrap",
      commandDirectory: path.join(root, "command"),
    });
  }
  async function agencyNames() {
    return (
      await db.query("select name from public.agency order by name")
    ).rows.map((row) => row.name);
  }
  test("empty agency table adds canonical historical roots and descendants alongside ordinary open roots", async () => {
    await writeRoots();
    expect(await load()).toMatchObject({ ok: true });
    expect(await agencyNames()).toEqual(["Historical PD", "Open PD"]);
    expect(
      (
        await db.query(
          "select a.id, ap.end_date::text, p.first_name from public.agency a join public.agency_personnel ap on ap.agency_id=a.id join public.personnel p on p.id=ap.personnel_id where a.id='canonical-historical'",
        )
      ).rows,
    ).toEqual([
      {
        id: "canonical-historical",
        end_date: "2001-01-01",
        first_name: "Historical",
      },
    ]);
  });
  test("listed roots cannot reintroduce an invalid TCOLE department or an explicitly excluded department", async () => {
    await writeRoots();
    const department = (id: string, address: string) => ({
      DEPARTMENT_NUMBER: id,
      DEPARTMENT_NAME: id,
      STATE: "TX",
      STATUS: "INACTIVE",
      DATE_OFFICIAL: "2001-01-01",
      ADD_LINE1: address,
      ADD_LINE2: "",
      CITY: "Austin",
      ZIP_CODE: "78701",
      HEAD_NAME: "",
      E_MAIL: "",
      PHONE: "5125550100",
      FAX: "",
    });
    const departments = [
      department("invalid-removed", " NuLl "),
      department("excluded-removed", "1 Main St"),
    ];
    const manifest = await transform({
      paths: ["departments.xlsx"],
      state: root,
      emit: async () => {},
      readXlsx: async (_file, sheet) =>
        sheet === "Departments" ? departments : [],
    });
    // The real TCOLE transform rejects the invalid address before roots are read.
    expect(
      Object.keys(
        manifest.artifacts.find((artifact) => artifact.kind === "Agencies")!
          .records,
      ),
    ).toEqual(["excluded-removed"]);
    expect(departments[0]!.ADD_LINE1).toBe(" NuLl ");
    const filtered = excludeManifestRecords(
      manifest,
      new Map([
        [
          excludedRecordKey("Agency", "excluded-removed"),
          {
            kind: "Agency",
            key: "excluded-removed",
            reason: "Explicit test exclusion",
          },
        ],
      ]),
    );
    expect(filtered.removed).toEqual({ Agency: 1, AgencyPhoneNumber: 1 });
    const input = await Artifacts.write(
      root,
      buildArtifactsEnvelope("source.one", "filtered-tcole", filtered.manifest),
    );
    expect(
      await importArtifacts({
        artifactsPath: input.path,
        env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
        commandName: "filtered-tcole",
        commandDirectory: path.join(root, "filtered-command"),
      }),
    ).toMatchObject({ ok: true });
    expect(await agencyNames()).toEqual([]);
    expect(
      (await db.query("select id from public.agency_phone_numbers")).rows,
    ).toEqual([]);
  });
  test("an unrelated existing agency disables initial roots globally", async () => {
    await writeRoots();
    await db.query(
      "insert into public.agency (id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values ('unrelated','Unrelated PD','Austin','TX','2 Main St','78701','unrelated','bootstrap-tx',30,-97)",
    );
    expect(await load()).toMatchObject({ ok: true });
    expect(await agencyNames()).toEqual(["Open PD", "Unrelated PD"]);
  });
  test("a different namespace's configured roots do not qualify agencies", async () => {
    await writeRoots("source.two");
    expect(await load()).toMatchObject({ ok: true });
    expect(await agencyNames()).toEqual(["Open PD"]);
  });
  test("malformed configured roots fail before any agency writes", async () => {
    const file = await writeRoots();
    await writeFile(file.path, "not: an envelope");
    expect(await load()).toMatchObject({
      ok: false,
      error: expect.stringContaining("InitialAgencyRoots is malformed"),
    });
    expect(await agencyNames()).toEqual([]);
  });
  test("initial run context retains saved agencies after an earlier office import", async () => {
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "reference.source", name: "office" },
        spec: {
          artifacts: [
            {
              kind: "FederalAgencies",
              spec: {
                records: {
                  parent: {
                    spec: {
                      name: "Parent Organization",
                      slug: "parent-organization",
                    },
                  },
                },
              },
            },
            {
              kind: "Agencies",
              spec: {
                records: {
                  office: {
                    spec: {
                      name: "First Office",
                      state: "TX",
                      city: "Austin",
                      address: "1 Main St",
                      zip_code: "78701",
                      location_path_id: "bootstrap-tx",
                      latitude: 30,
                      longitude: -97,
                      parent_federal_agency_id: "parent",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(
      await importArtifacts({
        artifactsPath: input.path,
        env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
        commandName: "office",
        commandDirectory: path.join(root, "first-command"),
      }),
    ).toMatchObject({ ok: true });
    await writeRoots();
    expect(await load(true)).toMatchObject({ ok: true });
    expect(await agencyNames()).toEqual([
      "First Office",
      "Historical PD",
      "Open PD",
    ]);
  });
});
