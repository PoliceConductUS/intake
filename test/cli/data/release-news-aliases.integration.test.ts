import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { writeCommandPointer } from "../../../src/cli/state/command-pointer.js";
import { listEntries } from "../../../src/cli/data/chain.js";
import { createSourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";

let db: IntakeDatabase;
let workspace: string;
const source = "org.policeconduct.release-news";
const a = "https://publisher.example/News";
const b = "https://syndicated.example/" + "story-".repeat(60);
beforeAll(async () => {
  db = await startIntakeDatabase();
  workspace = await mkdtemp(path.join(tmpdir(), "release-news-cli-"));
  vi.stubEnv("DATABASE_URL", db.connectionString);
  vi.stubEnv("INTAKE_WORKSPACE", workspace);
  vi.stubEnv("INTAKE_WORKSPACE_TEST", workspace);
}, 180_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.stop();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
async function command(...args: string[]) {
  const result = await runIntake(["data", ...args]);
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
}
async function release(url: string, aliases: Record<string, string>) {
  const dir = path.join(workspace, "fixture");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "alias.json"),
    JSON.stringify({ CoverageLink: aliases }),
  );
  const ref = { namespace: "google.news", sourceId: url };
  const occurrence = {
    ...ref,
    url,
    title: "Story",
    sourceName: null,
    publishedAt: "2026-11-14",
    summary: "Independent summary",
    domainRank: url === b ? 1 : 2,
  };
  await writeFile(
    path.join(dir, "page.news.json"),
    JSON.stringify({
      articles: [
        {
          ...ref,
          preferredUrl: url,
          normalizedUrl: url,
          occurrences: { [url]: occurrence },
          relationships: [],
        },
      ],
    }),
  );
  await writeCommandPointer(path.join(workspace, "state", source), "acquire", {
    latest: path.relative(workspace, dir),
  });
  await command("transform", source);
  await command("generate", source);
  await command("up");
}
it("reuses an ordinary coverage row via an alias, preserving URL and ID on historical replay", async () => {
  // A previous coverage source established the normalized URL before Daily discovered this story.
  await db.query(
    "insert into coverage_links (id,url,normalized_url,title) values ($1,$1,$1,'Story')",
    [a],
  );
  await release(b, { [b]: a });
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  expect(await ledger.read("google.news", "CoverageLink", a)).toBe(a);
  expect(await ledger.read("google.news", "CoverageLink", b)).toBe(a);
  const rows = async () =>
    (await db.query("select id,url,occurrences from coverage_links")).rows;
  expect(await rows()).toMatchObject([{ id: a, url: b }]);
  await release(a, {});
  const saved = await rows();
  expect(saved).toMatchObject([
    {
      id: a,
      url: b,
      occurrences: { [a]: { sourceId: a }, [b]: { sourceId: b } },
    },
  ]);
  const chain = await listEntries();
  await release(b, {});
  expect(await listEntries()).toEqual(chain);
  expect(await rows()).toEqual(saved);
}, 30_000);
