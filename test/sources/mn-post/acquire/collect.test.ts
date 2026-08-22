import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  collectSources,
  type AgencyFilters,
  type PostClient,
} from "../../../../sources/mn-post/acquire/collect.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeSourceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-collect-"));
  tempDirs.push(dir);
  return path.join(dir, "source");
}

const noFilters: AgencyFilters = {
  allowEmptyAgencySearch: [],
  supplementalAgencies: [],
};

function fakeClient(overrides: Partial<PostClient> = {}): PostClient {
  return {
    searchAgency: vi.fn(async (agencyName: string) => ({
      agencyName,
      candidateMatches: [{ Id: `id-${agencyName}` }],
      matches: [{ Id: `id-${agencyName}` }],
    })),
    fetchOfficerList: vi.fn(async () => [
      { contactId: "c1", licenseId: "lic1", name: "Smith, John" },
    ]),
    fetchOfficerDetail: vi.fn(async () => ({
      disciplinaryActions: "No POST Disciplinary Actions found",
    })),
    ...overrides,
  };
}

async function filesEndingWith(dir: string, suffix: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(suffix));
}

const oneAgencyCsv = "Agency\nAlpha Police Dept.\n";

describe("collectSources", () => {
  it("writes the raw csv, matches, roster, and detail — preserving format", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient();
    await collectSources({
      sourceDir,
      agencyFilters: noFilters,
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: { s: 1 } }),
      client,
    });

    const agenciesDir = path.join(sourceDir, "agencies");
    const officersDir = path.join(sourceDir, "officers");
    expect(await readFile(path.join(agenciesDir, "agencies.csv"), "utf8")).toBe(
      oneAgencyCsv,
    );
    expect(await filesEndingWith(agenciesDir, ".matches.json")).toHaveLength(1);

    const rosters = await filesEndingWith(officersDir, ".roster.json");
    expect(rosters).toHaveLength(1);
    const roster = JSON.parse(
      await readFile(path.join(officersDir, rosters[0]), "utf8"),
    );
    expect(roster).toEqual([
      { contactId: "c1", licenseId: "lic1", name: "Smith, John" },
    ]);

    const details = await filesEndingWith(officersDir, ".detail.json");
    expect(details).toHaveLength(1);
    expect(
      JSON.parse(await readFile(path.join(officersDir, details[0]), "utf8")),
    ).toEqual({ disciplinaryActions: "No POST Disciplinary Actions found" });
  });

  it("resumes: a second run re-fetches nothing already on disk", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient();
    const fetchAgencyCsv = vi.fn(async () => ({
      body: oneAgencyCsv,
      citation: {},
    }));
    const deps = {
      sourceDir,
      agencyFilters: noFilters,
      fetchAgencyCsv,
      client,
    };

    await collectSources(deps);
    await collectSources(deps);

    expect(fetchAgencyCsv).toHaveBeenCalledTimes(1);
    expect(client.searchAgency).toHaveBeenCalledTimes(1);
    expect(client.fetchOfficerList).toHaveBeenCalledTimes(1);
    expect(client.fetchOfficerDetail).toHaveBeenCalledTimes(1);
  });

  it("skips (and reports) an agency the site cannot resolve, without fetching its officers", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient({
      searchAgency: vi.fn(async (agencyName: string) => ({
        agencyName,
        candidateMatches: [{ Id: "a" }, { Id: "b" }],
        matches: [{ Id: "a" }, { Id: "b" }],
      })),
    });
    const result = await collectSources({
      sourceDir,
      agencyFilters: noFilters,
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      client,
    });
    expect(client.fetchOfficerList).not.toHaveBeenCalled();
    expect(result.skippedAgencies).toEqual([
      {
        agencyName: "Alpha Police Dept.",
        reason: "site agency search returned no resolvable id",
        candidateCount: 2,
      },
    ]);
  });

  it("fetches the roster from a cached id when the site search returns nothing", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient({
      searchAgency: vi.fn(async (agencyName: string) => ({
        agencyName,
        candidateMatches: [],
        matches: [],
      })),
    });
    const result = await collectSources({
      sourceDir,
      agencyFilters: noFilters,
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      client,
      knownAgencyIds: new Map([["Alpha Police Dept.", "a2jCACHED"]]),
    });
    expect(result.skippedAgencies).toEqual([]);
    // fetched by the cached id via a synthetic match, not the (empty) search result
    expect(client.fetchOfficerList).toHaveBeenCalledWith({ Id: "a2jCACHED" });
  });

  it("skips (and reports) a roster officer missing a licenseId", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient({
      fetchOfficerList: vi.fn(async () => [
        { contactId: "c1", licenseId: "lic1", name: "Has, License" },
        { contactId: "c2", name: "No, License" },
      ]),
    });
    const result = await collectSources({
      sourceDir,
      agencyFilters: noFilters,
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      client,
    });
    expect(client.fetchOfficerDetail).toHaveBeenCalledTimes(1);
    expect(result.skippedOfficers).toEqual([
      {
        agencyName: "Alpha Police Dept.",
        officer: "No, License",
        reason: "roster row is missing a licenseId",
      },
    ]);
  });

  it("allows an empty roster for an allow-listed agency without fetching officers", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient({
      searchAgency: vi.fn(async (agencyName: string) => ({
        agencyName,
        candidateMatches: [],
        matches: [],
      })),
    });
    await collectSources({
      sourceDir,
      agencyFilters: {
        allowEmptyAgencySearch: ["Alpha Police Dept."],
        supplementalAgencies: [],
      },
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      client,
    });

    expect(client.fetchOfficerList).not.toHaveBeenCalled();
    const rosters = await filesEndingWith(
      path.join(sourceDir, "officers"),
      ".roster.json",
    );
    expect(
      JSON.parse(
        await readFile(path.join(sourceDir, "officers", rosters[0]), "utf8"),
      ),
    ).toEqual([]);
  });

  it("searches supplemental agencies missing from the csv", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient();
    await collectSources({
      sourceDir,
      agencyFilters: {
        allowEmptyAgencySearch: [],
        supplementalAgencies: [{ agencyName: "Beta County Sheriff" }],
      },
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      client,
    });
    const searched = (
      client.searchAgency as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(searched).toEqual(["Alpha Police Dept.", "Beta County Sheriff"]);
  });
});
