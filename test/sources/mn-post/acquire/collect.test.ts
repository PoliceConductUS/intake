import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  collectSources,
  type PostClient,
} from "../../../../sources/mn-post/acquire/collect.js";
import type {
  AgencyIdCache,
  AgencyIdLookup,
} from "../../../../sources/mn-post/acquire/agency-id-cache.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeSourceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-collect-"));
  tempDirs.push(dir);
  return path.join(dir, "source");
}

// Production-shaped fixtures: a roster row and an officer detail as the POST
// site returns them.
const sampleOfficer = {
  status: "Active",
  originalLicenseIssueDate: "2010-05-01",
  name: "Smith, John Robert",
  licenseType: "Peace Officer",
  licenseNumber: "12527",
  licenseId: "a2j40000000cso1AAA",
  isCLEO: false,
  contactId: "0034000001mtIB3AAM",
};
const noDisciplineDetail = {
  education: [],
  disciplinaryActions: "No POST Disciplinary Actions found",
  activeEmployment: [],
  licenses: [],
};

function fakeClient(overrides: Partial<PostClient> = {}): PostClient {
  return {
    searchAgency: vi.fn(async (agencyName: string) => ({
      agencyName,
      candidateMatches: [],
      matches: [],
    })),
    fetchOfficerList: vi.fn(async () => [sampleOfficer]),
    fetchOfficerDetails: vi.fn(async (officers) =>
      officers.map(() => ({ ...noDisciplineDetail })),
    ),
    ...overrides,
  };
}

function fakeCache(
  resolve: (agencyName: string) => Promise<AgencyIdLookup> = async (
    agencyName,
  ) => ({ kind: "resolved", agencyId: `id-${agencyName}` }),
): AgencyIdCache {
  return { resolve: vi.fn(resolve), entries: () => ({}) };
}

async function filesEndingWith(dir: string, suffix: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(suffix));
}

const oneAgencyCsv = "Agency\nAlpha Police Dept.\n";

describe("collectSources", () => {
  it("writes the raw csv, roster, and detail — preserving format", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient();
    await collectSources({
      sourceDir,
      supplementalAgencyNames: [],
      excludedAgencyNames: [],
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: { s: 1 } }),
      cache: fakeCache(),
      client,
    });

    const officersDir = path.join(sourceDir, "officers");
    expect(
      await readFile(path.join(sourceDir, "agencies", "agencies.csv"), "utf8"),
    ).toBe(oneAgencyCsv);

    const rosters = await filesEndingWith(officersDir, ".roster.json");
    expect(rosters).toHaveLength(1);
    expect(
      JSON.parse(await readFile(path.join(officersDir, rosters[0]), "utf8")),
    ).toEqual([sampleOfficer]);

    const details = await filesEndingWith(officersDir, ".detail.json");
    expect(details).toHaveLength(1);
    expect(
      JSON.parse(await readFile(path.join(officersDir, details[0]), "utf8")),
    ).toEqual(noDisciplineDetail);
    expect(client.fetchOfficerList).toHaveBeenCalledWith(
      "id-Alpha Police Dept.",
    );
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
      supplementalAgencyNames: [],
      excludedAgencyNames: [],
      fetchAgencyCsv,
      cache: fakeCache(),
      client,
    };

    await collectSources(deps);
    await collectSources(deps);

    expect(fetchAgencyCsv).toHaveBeenCalledTimes(1);
    expect(client.fetchOfficerList).toHaveBeenCalledTimes(1);
    expect(client.fetchOfficerDetails).toHaveBeenCalledTimes(1);
  });

  it("skips (and reports) an agency the cache cannot resolve", async () => {
    const sourceDir = await makeSourceDir();
    const client = fakeClient();
    const result = await collectSources({
      sourceDir,
      supplementalAgencyNames: [],
      excludedAgencyNames: [],
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      cache: fakeCache(async () => ({
        kind: "skip",
        reason: "site agency search returned no resolvable id",
        candidateCount: 0,
      })),
      client,
    });
    expect(client.fetchOfficerList).not.toHaveBeenCalled();
    expect(result.skippedAgencies).toEqual([
      {
        agencyName: "Alpha Police Dept.",
        reason: "site agency search returned no resolvable id",
        candidateCount: 0,
      },
    ]);
  });

  it("does not resolve or scrape an excluded agency", async () => {
    const sourceDir = await makeSourceDir();
    const cache = fakeCache();
    await collectSources({
      sourceDir,
      supplementalAgencyNames: [],
      excludedAgencyNames: ["Alpha Police Dept."],
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      cache,
      client: fakeClient(),
    });
    expect(cache.resolve).not.toHaveBeenCalled();
    expect(
      await filesEndingWith(path.join(sourceDir, "officers"), ".roster.json"),
    ).toEqual([]);
  });

  it("skips (and reports) a roster officer missing a licenseId", async () => {
    const sourceDir = await makeSourceDir();
    const withLicense = { ...sampleOfficer, name: "Has, License" };
    const withoutLicense = {
      ...sampleOfficer,
      name: "No, License",
      contactId: "0034000001noLICaa",
      licenseId: undefined,
    };
    const client = fakeClient({
      fetchOfficerList: vi.fn(async () => [withLicense, withoutLicense]),
    });
    const result = await collectSources({
      sourceDir,
      supplementalAgencyNames: [],
      excludedAgencyNames: [],
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      cache: fakeCache(),
      client,
    });
    // only the licensed officer is batched for detail fetching
    expect(client.fetchOfficerDetails).toHaveBeenCalledWith([withLicense]);
    expect(result.skippedOfficers).toEqual([
      {
        agencyName: "Alpha Police Dept.",
        officer: "No, License",
        reason: "roster row is missing a licenseId",
      },
    ]);
  });

  it("resolves supplemental agencies missing from the csv", async () => {
    const sourceDir = await makeSourceDir();
    const cache = fakeCache();
    await collectSources({
      sourceDir,
      supplementalAgencyNames: ["Beta County Sheriff"],
      excludedAgencyNames: [],
      fetchAgencyCsv: async () => ({ body: oneAgencyCsv, citation: {} }),
      cache,
      client: fakeClient(),
    });
    const resolved = (cache.resolve as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(resolved).toEqual(["Alpha Police Dept.", "Beta County Sheriff"]);
  });
});
