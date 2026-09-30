import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { sourceStateDir } from "../../../src/cli/transform/state.js";
import { readLatest } from "../../../sources/org.policeconduct.manual/chain.js";
import { listEntries } from "../../../src/cli/data/chain.js";
import { DatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { persistSourceNameToCanonicalIds } from "../../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("manual report updates through the data CLI", () => {
  let db: IntakeDatabase;
  let workspace: string;
  const source = "org.policeconduct.manual";

  beforeAll(async () => {
    db = await startIntakeDatabase();
    workspace = await mkdtemp(path.join(tmpdir(), "report-update-"));
    vi.stubEnv("INTAKE_WORKSPACE", workspace);
    vi.stubEnv("DATABASE_URL", db.connectionString);
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.stop();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  async function command(...args: string[]) {
    const result = await runIntake(["data", ...args]);
    expect(result, result.stderr).toMatchObject({ exitCode: 0 });
    return result;
  }

  async function acquire(kind: string, record: Record<string, unknown>) {
    vi.stubEnv("MANUAL_KIND", kind);
    vi.stubEnv("MANUAL_RECORD", JSON.stringify(record));
    await command("acquire", source);
  }

  async function generate() {
    await command("transform", source);
    return command("generate", source);
  }

  async function storedReport() {
    return (
      await db.query(
        "select id, slug, title, description, desired_outcome, incident_date::text, location_path_id, latitude, longitude, case_number from public.reviews",
      )
    ).rows;
  }

  test("generates and applies changed prose without changing identity, then emits no entry for unchanged input", async () => {
    await acquire("LocationPath", {
      location_path_id: "/root/",
      path: "/root/",
      level: "state",
      display_name: "Test State",
      parent_location_path_id: null,
    });
    await acquire("LocationPath", {
      location_path_id: "/zz/",
      path: "/zz/",
      level: "place",
      display_name: "Test State",
      parent_location_path_id: "/root/",
    });
    await generate();
    await command("up");
    const location = (
      await db.query(
        "select location_path_id from public.location_path where level = 'place'",
      )
    ).rows[0]!;
    await db.query(
      "insert into public.agency (id, name, state, city, address, zip_code, location_path_id, latitude, longitude, slug) values ('report-agency', 'Test Agency', 'TX', 'Test City', '1 Main St', '75001', $1, 32.8, -96.8, 'test-agency')",
      [location.location_path_id],
    );
    await db.query(
      "insert into public.personnel (id, first_name, last_name, slug) values ('report-person', 'Test', 'Officer', 'test-officer')",
    );
    await db.query(
      "insert into public.agency_personnel (id, agency_id, personnel_id, start_date, end_date, title) values ('report-assignment', 'report-agency', 'report-person', '2020-01-01', null, 'Officer')",
    );
    await persistSourceNameToCanonicalIds(
      source,
      {
        locationPaths: {},
        agencies: {},
        personnel: {},
        agencyPersonnel: {
          "report-assignment": { canonicalId: "report-assignment" },
        },
      },
      { rootDir: workspace },
    );
    const report = {
      id: "ptapguvzxequnlrueybkgcsa",
      title: "Original report title",
      description: "Original report description.",
      desired_outcome: "Original requested outcome.",
      incident_date: "2023-12-04T08:00:00.9999999Z",
      location_path_id: location.location_path_id,
      latitude: 32.8,
      longitude: -96.8,
    };
    await acquire("Review", { ...report, case_number: "CASE-123" });
    await acquire("ReviewPersonnel", {
      id: "report-assignment-link",
      review_id: report.id,
      agency_personnel_id: "report-assignment",
    });
    await generate();
    const initialMutation = (
      await DatabaseMutations.read((await listEntries())[1]!.filePath)
    ).spec.mutations.find((mutation) => mutation.kind === "ReviewCreate");
    expect(initialMutation).toMatchObject({
      spec: { incident_date: "2023-12-04T08:00:00Z" },
    });
    expect(
      (
        await readLatest(await sourceStateDir(process.env, source))
      ).entries.find((entry) => entry.kind === "Review")?.record.incident_date,
    ).toBe("2023-12-04T08:00:00.9999999Z");
    await command("up");
    const original = await storedReport();
    expect(original).toEqual([
      {
        ...report,
        incident_date: "2023-12-04 08:00:00+00",
        slug: expect.any(String),
        case_number: "CASE-123",
      },
    ]);

    await acquire("Review", {
      ...report,
      title: "Revised report title",
      description: "Revised report description.",
      desired_outcome: "Revised requested outcome.",
    });
    const generated = await generate();
    expect(await storedReport()).toEqual(original);
    const entries = await listEntries();
    expect(entries, generated.stdout).toHaveLength(3);
    const envelope = await DatabaseMutations.read(entries[2]!.filePath);
    const updates = envelope.spec.mutations.filter(
      (mutation) => mutation.kind === "ReviewUpdate",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      name: report.id,
      spec: {
        operations: expect.arrayContaining([
          expect.objectContaining({
            action: "set",
            path: "title",
            from: "Original report title",
            to: "Revised report title",
          }),
          expect.objectContaining({
            action: "set",
            path: "description",
            from: "Original report description.",
            to: "Revised report description.",
          }),
          expect.objectContaining({
            action: "set",
            path: "desired_outcome",
            from: "Original requested outcome.",
            to: "Revised requested outcome.",
          }),
          expect.objectContaining({
            action: "check",
            path: "incident_date",
          }),
        ]),
      },
    });

    await command("up");
    expect(await storedReport()).toEqual([
      {
        ...original[0],
        title: "Revised report title",
        description: "Revised report description.",
        desired_outcome: "Revised requested outcome.",
      },
    ]);
    await generate();
    expect(await listEntries()).toEqual(entries);

    const revised = {
      ...report,
      title: "Title-only revision",
      description: "Revised report description.",
      desired_outcome: "Revised requested outcome.",
      incident_date: "2023-12-04T02:00:00.000-06:00",
    };
    await acquire("Review", revised);
    await generate();
    const titleEntry = (await listEntries())[3]!;
    const titleMutation = (
      await DatabaseMutations.read(titleEntry.filePath)
    ).spec.mutations.find((mutation) => mutation.kind === "ReviewUpdate")!;
    const titleOperations = titleMutation.spec.operations;
    if (!Array.isArray(titleOperations))
      throw new Error("Expected update operations");
    expect(
      titleOperations.filter((operation) => operation.action === "set"),
    ).toEqual([
      expect.objectContaining({ path: "title", to: "Title-only revision" }),
    ]);
    await command("up");
    await generate();
    expect(await listEntries()).toHaveLength(4);

    await acquire("Review", {
      ...revised,
      incident_date: "2023-12-04T08:00:01.9999999Z",
    });
    await generate();
    const dateEntry = (await listEntries())[4]!;
    const dateMutation = (
      await DatabaseMutations.read(dateEntry.filePath)
    ).spec.mutations.find((mutation) => mutation.kind === "ReviewUpdate")!;
    expect(dateMutation.spec.operations).toContainEqual(
      expect.objectContaining({
        action: "set",
        path: "incident_date",
        from: "2023-12-04T08:00:00Z",
        to: "2023-12-04T08:00:01Z",
      }),
    );
    await command("up");
    const dated = await storedReport();
    expect(dated).toEqual([
      {
        ...original[0],
        title: "Title-only revision",
        description: "Revised report description.",
        desired_outcome: "Revised requested outcome.",
        incident_date: "2023-12-04 08:00:01+00",
      },
    ]);
    await generate();
    expect(await listEntries()).toHaveLength(5);
    await acquire("Review", {
      ...revised,
      incident_date: "2023-12-04T08:00:01.123Z",
    });
    await generate();
    expect(await listEntries()).toHaveLength(5);

    const conflict = await runIntake([
      "replay",
      "database-mutations",
      dateEntry.filePath,
    ]);
    expect(conflict).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("expected incident_date"),
    });
    expect(await storedReport()).toEqual(dated);

    const directId = "direct-replay-report";
    const directCreate = await DatabaseMutations.write(
      workspace,
      DatabaseMutations.new({
        metadata: { name: "direct-create", namespace: source },
        spec: {
          mutations: [
            {
              kind: "ReviewCreate",
              name: directId,
              spec: {
                ...report,
                id: directId,
                slug: "direct-replay-report",
                incident_date: "2023-12-04T02:00:00.9999999-06:00",
              },
            },
          ],
        },
      }),
    );
    expect(
      await runIntake(["replay", "database-mutations", directCreate.path]),
    ).toMatchObject({ exitCode: 0 });
    expect(
      (
        await db.query(
          "select incident_date::text from public.reviews where id = $1",
          [directId],
        )
      ).rows,
    ).toEqual([{ incident_date: "2023-12-04 08:00:00+00" }]);
    const directUpdate = await DatabaseMutations.write(
      workspace,
      DatabaseMutations.new({
        metadata: { name: "direct-update", namespace: source },
        spec: {
          mutations: [
            {
              kind: "ReviewUpdate",
              name: directId,
              spec: {
                operations: [
                  {
                    action: "set",
                    path: "incident_date",
                    from: "2023-12-04T08:00:00.111Z",
                    to: "2023-12-04T08:00:01.9999999Z",
                    reason: "Update incident second",
                    source: {
                      namespace: source,
                      command: { name: "direct-update" },
                      kind: "Review",
                      name: directId,
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(
      await runIntake(["replay", "database-mutations", directUpdate.path]),
    ).toMatchObject({ exitCode: 0 });
    expect(
      (
        await db.query(
          "select incident_date::text from public.reviews where id = $1",
          [directId],
        )
      ).rows,
    ).toEqual([{ incident_date: "2023-12-04 08:00:01+00" }]);
  }, 180_000);
});
