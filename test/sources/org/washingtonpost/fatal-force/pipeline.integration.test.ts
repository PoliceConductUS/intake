import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { runIntake } from "../../../../../src/cli/index.js";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../../../../cli/database/intake-postgres.js";
let db: IntakeDatabase;
let workspace: string;
const source = "org/washingtonpost/fatal-force";
beforeAll(async () => {
  db = await startIntakeDatabase();
  workspace = await mkdtemp(path.join(tmpdir(), "fatal-force-pipeline-"));
  vi.stubEnv("INTAKE_WORKSPACE", workspace);
  vi.stubEnv("DATABASE_URL", db.connectionString);
}, 180000);
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db?.stop();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
async function command(...args: string[]) {
  const result = await runIntake(["data", ...args]);
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
  return result;
}
function snapshot(commit: string, age: number) {
  vi.stubEnv("FATAL_FORCE_COMMIT", commit);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("agencies.csv")
            ? "id,name,type,state,oricodes,total_shootings\n7,Synthetic Agency,local_police,ZZ,,1\n"
            : `id,date,threat_type,flee_status,armed_with,city,county,state,latitude,longitude,location_precision,name,age,gender,race,race_source,was_mental_illness_related,body_camera,agency_ids\n1,2020-02-29,undetermined,not,unarmed,,,,,,,Synthetic Person,${age},male,,,False,True,7\n`,
        ),
    ),
  );
}
test("imports both files, compares unchanged inputs, and updates a changed pin without changing canonical identity", async () => {
  snapshot("a".repeat(40), 23);
  await command("acquire", source);
  await command("transform", source);
  expect((await command("generate", source)).stdout).toContain("2 mutations");
  await command("up");
  const first = (await db.query("select id, age from fatal_shooting")).rows[0]!;
  expect(Number(first.age)).toBe(23);
  await command("acquire", source);
  expect(fetch).toHaveBeenCalledTimes(2);
  await command("transform", source);
  expect((await command("generate", source)).stdout).toContain("empty diff");
  expect((await command("up")).stdout).toContain("up to date");
  snapshot("b".repeat(40), 24);
  await command("acquire", source);
  await command("transform", source);
  expect((await command("generate", source)).stdout).toContain("2 mutations");
  await command("up");
  const second = (await db.query("select id, age from fatal_shooting"))
    .rows[0]!;
  expect(second.id).toBe(first.id);
  expect(Number(second.age)).toBe(24);
  expect((await command("generate", source)).stdout).toContain("empty diff");
  expect(
    (await db.query("select count(*)::int as count from agency")).rows,
  ).toEqual([{ count: 0 }]);
  expect(
    (await db.query("select agency_id from fatal_shooting_agency")).rows,
  ).toEqual([{ agency_id: null }]);
}, 120000);
