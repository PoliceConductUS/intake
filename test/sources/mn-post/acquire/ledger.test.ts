import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import {
  loadAgencyLedger,
  updateAgencyLedger,
} from "../../../../sources/mn-post/acquire/ledger.js";
import type { AgencyMatchResult } from "../../../../sources/mn-post/acquire/collect.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeStateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-ledger-"));
  tempDirs.push(dir);
  return dir;
}

function match(
  agencyName: string,
  id?: string,
  allowEmptyAgencySearch = false,
): AgencyMatchResult {
  const matches = id === undefined ? [] : [{ Id: id }];
  return {
    agencyName,
    candidateMatches: matches,
    matches,
    allowEmptyAgencySearch,
  };
}

describe("updateAgencyLedger", () => {
  it("mints a new agency's id from its Salesforce match id", async () => {
    const statePath = await makeStateDir();
    const ledger = await updateAgencyLedger({
      statePath,
      agencyMatches: [match("Alpha Police Dept.", "a2jALPHA")],
      now: "2026-01-01T00:00:00Z",
    });
    expect(ledger["Alpha Police Dept."].id).toBe("a2jALPHA");
    // persisted, so a later run reads the same identity
    expect(await loadAgencyLedger(statePath)).toEqual(ledger);
  });

  it("mints a fresh id for an allowed-empty agency with no match", async () => {
    const statePath = await makeStateDir();
    const ledger = await updateAgencyLedger({
      statePath,
      agencyMatches: [match("Verndale Police Dept.", undefined, true)],
      now: "2026-01-01T00:00:00Z",
      createAgencyId: () => "generated-id",
    });
    expect(ledger["Verndale Police Dept."].id).toBe("generated-id");
  });

  it("keeps a known agency's stored id even when the search returns a different id (no drift guard)", async () => {
    const statePath = await makeStateDir();
    await writeFile(
      path.join(statePath, "agencies.yaml"),
      stringifyYaml({
        "Alpha Police Dept.": {
          id: "a2jSTORED",
          firstSeenAt: "2020-01-01T00:00:00Z",
        },
      }),
    );
    const ledger = await updateAgencyLedger({
      statePath,
      agencyMatches: [match("Alpha Police Dept.", "a2jCHANGED")],
      now: "2026-01-01T00:00:00Z",
    });
    expect(ledger["Alpha Police Dept."].id).toBe("a2jSTORED");
    expect(ledger["Alpha Police Dept."].firstSeenAt).toBe(
      "2020-01-01T00:00:00Z",
    );
  });

  it("fails loud for a new agency with neither a match nor an empty allowance", async () => {
    const statePath = await makeStateDir();
    await expect(
      updateAgencyLedger({
        statePath,
        agencyMatches: [match("Ghost Police Dept.")],
        now: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/missing POST agency source id/);
  });
});
