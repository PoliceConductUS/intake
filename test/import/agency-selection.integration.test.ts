import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const describeWithDocker = dockerAvailable() ? describe : describe.skip;
describeWithDocker("shared agency selection in the import pipeline", () => {
  let db: IntakeDatabase;
  const roots: string[] = [];
  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  async function workspace() {
    const root = await mkdtemp(path.join(tmpdir(), "agency-selection-"));
    roots.push(root);
    return root;
  }
  test("an unqualified agency needs no address resolution and produces no agency mutation", async () => {
    const root = await workspace();
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "graph-empty", name: "empty" },
        spec: {
          artifacts: [
            {
              kind: "Agencies",
              spec: {
                records: {
                  unqualified: {
                    spec: { name: "Unqualified PD", state: "TX" },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    const result = await importArtifacts({
      artifactsPath: input.path,
      env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
      commandName: "empty",
      commandDirectory: path.join(root, "command"),
      resolveAgencyCoordinates: async () => {
        throw new Error("Unqualified agency reached geocoding");
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect((await db.query("select id from public.agency")).rows).toEqual([]);
  });
  test("a later personnel source uses persisted assignment reachability and preserves its canonical identity", async () => {
    const root = await workspace();
    await db.query(
      "insert into public.location_path (location_path_id,path,level,display_name) values ('tx-graph','/tx/','state','Texas')",
    );
    await db.query(
      "insert into public.agency (id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values ('a-graph','Agency','Austin','TX','1 Main St','78701','agency-graph','tx-graph',30,-97)",
    );
    await db.query(
      "insert into public.personnel (id,first_name,slug) values ('p-graph','Original','person-graph')",
    );
    await db.query(
      "insert into public.agency_personnel (id,agency_id,personnel_id,start_date,end_date,title) values ('job-graph','a-graph','p-graph','2020-01-01',null,'Officer')",
    );
    await persistSourceNameToCanonicalIds(
      "graph-later",
      {
        locationPaths: {},
        agencies: {},
        agencyPersonnel: {},
        personnel: {
          sourceperson: { kind: "Personnel", canonicalId: "p-graph" },
        },
      },
      { rootDir: root },
    );
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "graph-later", name: "later" },
        spec: {
          artifacts: [
            {
              kind: "Personnel",
              spec: {
                records: {
                  sourceperson: { spec: { first_name: "Corrected" } },
                },
              },
            },
          ],
        },
      }),
    );
    const result = await importArtifacts({
      artifactsPath: input.path,
      env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
      commandName: "later",
      commandDirectory: path.join(root, "command"),
    });
    expect(result).toMatchObject({ ok: true });
    expect(
      (
        await db.query(
          "select id,first_name,slug from public.personnel where id='p-graph'",
        )
      ).rows,
    ).toEqual([
      { id: "p-graph", first_name: "Corrected", slug: "person-graph" },
    ]);
  });
  test("closing the last assignment updates its end date and retains stored history", async () => {
    const root = await workspace();
    await db.query(
      "insert into public.location_path (location_path_id,path,level,display_name) values ('tx-close','/tx-close/','state','Texas')",
    );
    await db.query(
      "insert into public.agency (id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values ('a-close','Closed Agency','Austin','TX','1 Main St','78701','agency-close','tx-close',30,-97)",
    );
    await db.query(
      "insert into public.personnel (id,first_name,slug) values ('p-close','Stored','person-close')",
    );
    await db.query(
      "insert into public.agency_personnel (id,agency_id,personnel_id,start_date,end_date,title) values ('job-close','a-close','p-close','2020-01-01',null,'Officer')",
    );
    await persistSourceNameToCanonicalIds(
      "graph-close",
      {
        locationPaths: {},
        agencies: { agency: { kind: "Agency", canonicalId: "a-close" } },
        personnel: { person: { kind: "Personnel", canonicalId: "p-close" } },
        agencyPersonnel: {
          job: { kind: "AgencyPersonnel", canonicalId: "job-close" },
        },
      },
      { rootDir: root },
    );
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "graph-close", name: "close" },
        spec: {
          artifacts: [
            {
              kind: "AgencyPhoneNumbers",
              spec: {
                records: {
                  closing: {
                    spec: {
                      agency_id: "agency",
                      phone_number: "555-0100",
                      description: "Closing record",
                    },
                  },
                },
              },
            },
            {
              kind: "AgencyPersonnel",
              spec: {
                records: {
                  job: {
                    spec: {
                      agency_id: "agency",
                      personnel_id: "person",
                      start_date: "2020-01-01",
                      title: "Officer",
                      end_date: "2026-09-01",
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
      artifactsPath: input.path,
      env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
      commandName: "close",
      commandDirectory: path.join(root, "command"),
    });
    expect(result).toMatchObject({ ok: true });
    expect(
      (
        await db.query(
          "select ap.id, ap.end_date::text, a.slug as agency_slug, p.slug as personnel_slug from public.agency_personnel ap join public.agency a on a.id=ap.agency_id join public.personnel p on p.id=ap.personnel_id where ap.id='job-close'",
        )
      ).rows,
    ).toEqual([
      {
        id: "job-close",
        end_date: "2026-09-01",
        agency_slug: "agency-close",
        personnel_slug: "person-close",
      },
    ]);
    expect(
      (
        await db.query(
          "select phone_number from public.agency_phone_numbers where agency_id='a-close'",
        )
      ).rows,
    ).toEqual([{ phone_number: "555-0100" }]);
    const later = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace: "graph-close", name: "after-close" },
        spec: {
          artifacts: [
            {
              kind: "Personnel",
              spec: {
                records: { person: { spec: { first_name: "Corrected" } } },
              },
            },
            {
              kind: "AgencyPhoneNumbers",
              spec: {
                records: {
                  later: {
                    spec: {
                      agency_id: "agency",
                      phone_number: "555-0101",
                      description: "Later record",
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
        artifactsPath: later.path,
        env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
        commandName: "after-close",
        commandDirectory: path.join(root, "after-close"),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await db.query(
          "select first_name, slug from public.personnel where id='p-close'",
        )
      ).rows,
    ).toEqual([{ first_name: "Corrected", slug: "person-close" }]);
    expect(
      (
        await db.query(
          "select phone_number from public.agency_phone_numbers where agency_id='a-close'",
        )
      ).rows,
    ).toEqual([{ phone_number: "555-0100" }]);
  });
  test("federal offices persist parent references without personnel or cases and support later descendants", async () => {
    const root = await workspace();
    const namespace = "federal-office-parent";
    await db.query(
      "insert into public.location_path (location_path_id,path,level,display_name) values ('federal-place','/federal-place/','place','Federal Place')",
    );
    await db.query(
      "insert into public.agency (id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values ('stored-office','Existing Office','Washington','DC','1 Main St','20001','preserved-office-slug','federal-place',38.9,-77)",
    );
    await db.query(
      "insert into public.personnel (id,first_name,slug) values ('former-federal-person','Former','former-federal-person')",
    );
    await db.query(
      "insert into public.agency_personnel (id,agency_id,personnel_id,start_date,end_date,title) values ('ended-federal-job','stored-office','former-federal-person','2020-01-01','2021-01-01','Agent')",
    );
    await persistSourceNameToCanonicalIds(
      namespace,
      {
        locationPaths: {},
        agencies: {
          existing: { kind: "Agency", canonicalId: "stored-office" },
        },
        agencyPersonnel: {},
        personnel: {},
      },
      { rootDir: root },
    );
    const office = (name: string) => ({
      name,
      parent_federal_agency_id: "parent",
      city: "Washington",
      state: "DC",
      address: "1 Main St",
      zip_code: "20001",
      location_path_id: "federal-place",
      latitude: 38.9,
      longitude: -77,
    });
    const input = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace, name: "offices" },
        spec: {
          artifacts: [
            {
              kind: "FederalAgencies",
              spec: {
                records: {
                  parent: {
                    spec: { name: "Federal Test", slug: "federal-test" },
                  },
                },
              },
            },
            {
              kind: "Agencies",
              spec: {
                records: {
                  existing: { spec: office("Existing Office") },
                  new: { spec: office("New Office") },
                  unrelated: {
                    spec: { name: "Unrelated Agency", state: "DC" },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    const run = (artifactsPath: string, name: string) =>
      importArtifacts({
        artifactsPath,
        env: { DATABASE_URL: db.connectionString, INTAKE_WORKSPACE_TEST: root },
        commandName: name,
        commandDirectory: path.join(root, name),
      });
    expect(await run(input.path, "offices")).toMatchObject({ ok: true });
    const rows = (
      await db.query(
        "select a.id,a.slug,a.location_path_id,a.parent_federal_agency_id,f.slug as parent_slug from public.agency a join public.federal_agency f on a.parent_federal_agency_id=f.id where f.slug='federal-test' order by a.name",
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "stored-office",
      slug: "preserved-office-slug",
      location_path_id: "federal-place",
      parent_slug: "federal-test",
    });
    expect(rows[1]).toMatchObject({
      location_path_id: "federal-place",
      parent_slug: "federal-test",
    });
    expect(rows[0].parent_federal_agency_id).not.toBe("parent");
    expect(rows[1].parent_federal_agency_id).toBe(
      rows[0].parent_federal_agency_id,
    );
    expect(
      (
        await db.query(
          "select id from public.agency where name='Unrelated Agency'",
        )
      ).rows,
    ).toEqual([]);
    expect(await run(input.path, "offices-repeat")).toMatchObject({ ok: true });
    expect(
      (
        await db.query(
          "select a.id,a.slug,a.location_path_id,a.parent_federal_agency_id,f.slug as parent_slug from public.agency a join public.federal_agency f on a.parent_federal_agency_id=f.id where f.slug='federal-test' order by a.name",
        )
      ).rows,
    ).toEqual(rows);
    const later = await Artifacts.write(
      root,
      Artifacts.new({
        metadata: { namespace, name: "office-phone" },
        spec: {
          artifacts: [
            {
              kind: "AgencyPhoneNumbers",
              spec: {
                records: {
                  phone: {
                    spec: {
                      agency_id: "existing",
                      phone_number: "555-0111",
                      description: "Office",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(await run(later.path, "later-office-phone")).toMatchObject({
      ok: true,
    });
    expect(
      (
        await db.query(
          "select phone_number from public.agency_phone_numbers where agency_id='stored-office'",
        )
      ).rows,
    ).toEqual([{ phone_number: "555-0111" }]);
  });
});
