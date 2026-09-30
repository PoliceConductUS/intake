import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { openAgencyIdCache } from "../../../../sources/mn-post/acquire/agency-id-cache.js";
import type { AgencyMatchResult } from "../../../../sources/mn-post/acquire/collect.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeStatePath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-cache-"));
  tempDirs.push(dir);
  return dir;
}

function search(
  matchIds: string[],
): (name: string) => Promise<AgencyMatchResult> {
  return async (agencyName) => {
    const matches = matchIds.map((Id) => ({ Id }));
    return { agencyName, candidateMatches: matches, matches };
  };
}

describe("openAgencyIdCache", () => {
  it("caches a search result that resolves to exactly one match, and persists it", async () => {
    const statePath = await makeStatePath();
    const searchAgency = vi.fn(search(["a2jALPHA"]));
    const cache = await openAgencyIdCache({
      statePath,
      searchAgency,
      now: "2026-01-01T00:00:00Z",
    });

    expect(await cache.resolve("Alpha Police Dept.")).toEqual({
      kind: "resolved",
      agencyId: "a2jALPHA",
    });
    const persisted = parseYaml(
      await readFile(path.join(statePath, "agencies.yaml"), "utf8"),
    );
    expect(persisted["Alpha Police Dept."].id).toBe("a2jALPHA");
  });

  it("returns a cached id without searching (drift-proof)", async () => {
    const statePath = await makeStatePath();
    await writeFile(
      path.join(statePath, "agencies.yaml"),
      stringifyYaml({ "Litchfield Police Dept.": { id: "a2jSTORED" } }),
    );
    const searchAgency = vi.fn(search(["a2jCHANGED"]));
    const cache = await openAgencyIdCache({
      statePath,
      searchAgency,
      now: "2026-01-01T00:00:00Z",
    });

    expect(await cache.resolve("Litchfield Police Dept.")).toEqual({
      kind: "resolved",
      agencyId: "a2jSTORED",
    });
    expect(searchAgency).not.toHaveBeenCalled();
  });

  it("skips an agency the search returns nothing for", async () => {
    const statePath = await makeStatePath();
    const cache = await openAgencyIdCache({
      statePath,
      searchAgency: search([]),
      now: "2026-01-01T00:00:00Z",
    });
    expect(await cache.resolve("Howard Lake Police Dept.")).toEqual({
      kind: "skip",
      reason: "site agency search returned no resolvable id",
      candidateCount: 0,
    });
  });

  it("skips an agency the search cannot resolve to exactly one match", async () => {
    const statePath = await makeStatePath();
    const cache = await openAgencyIdCache({
      statePath,
      searchAgency: search(["a", "b"]),
      now: "2026-01-01T00:00:00Z",
    });
    expect(await cache.resolve("Ambiguous Police Dept.")).toEqual({
      kind: "skip",
      reason: "site agency search returned no resolvable id",
      candidateCount: 2,
    });
  });
});
