import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  acquire,
  isNoResults,
} from "../../../../../sources/net/clearinghouse/api/acquire.js";
import type { AcquireAgencyRecord } from "../../../../../src/cli/transform/source-transform.js";
import { unusedServiceClients } from "../../../../shared/services/harness.js";

// The Clearinghouse API returns HTTP 400 with a `["No results for {...}"]` body
// for a zero-match search — a normal empty result, not a failure. Independent
// oracle: the literal shape observed from the live API.
describe("isNoResults", () => {
  it("recognizes the API's no-results 400 shape", () => {
    expect(
      isNoResults(400, [
        "No results for {'text': 'Spring Valley Police Department', 'state': '5859', 'case_type': '5039'}",
      ]),
    ).toBe(true);
  });

  it("is false for a 400 that is a real error, not a no-results marker", () => {
    expect(isNoResults(400, { detail: "Invalid state id." })).toBe(false);
    expect(isNoResults(400, ["Some other message"])).toBe(false);
  });

  it("is false for non-400 statuses even with a no-results-shaped body", () => {
    expect(isNoResults(200, ["No results for {...}"])).toBe(false);
    expect(isNoResults(429, ["No results for {...}"])).toBe(false);
  });
});

describe("net/clearinghouse/api acquire", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(
      tempDirs.splice(0).map((d) => rm(d, { recursive: true })),
    );
  });

  function agency(
    agencyId: string,
    name: string,
    state: string,
  ): AcquireAgencyRecord {
    return { agencyId, name, state, county: null, place: null };
  }

  // Illinois is state 5826 and Missouri 5837 in the Clearinghouse API.
  function stubFetch(
    search: (url: URL) => unknown = () => ({ results: [], next: null }),
  ) {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      return Response.json(
        url.pathname.endsWith("/dockets/") ? [] : search(url),
      );
    });
    return requests;
  }

  async function run(agencies: AcquireAgencyRecord[]) {
    const sourceDir = await mkdtemp(path.join(tmpdir(), "clearinghouse-acq-"));
    tempDirs.push(sourceDir);
    const logs: string[] = [];
    const result = acquire({
      clients: unusedServiceClients(),
      sourceDir,
      state: sourceDir,
      env: { CLEARING_HOUSE_API_TOKEN: "fixture" },
      data: { agencies: async () => ({ items: agencies }) },
      logger: { info: (message) => logs.push(message) },
    });
    return { sourceDir, logs, result };
  }

  it("throws naming the ID of an agency with a blank name, and makes no request for a later agency", async () => {
    const requests = stubFetch();
    const { result } = await run([
      agency("a-1", "Austin Police Department", "TX"),
      agency("a-2", "  ", "TX"),
      agency("a-3", "Dallas Police Department", "TX"),
    ]);
    await expect(result).rejects.toThrow(
      "net/clearinghouse/api: agency a-2 has a blank name.",
    );
    expect(requests.map((url) => url.searchParams.get("text"))).toEqual([
      "Austin Police Department",
    ]);
  });

  it("throws naming the ID of an agency whose state the Clearinghouse has no ID for, and makes no request for a later agency", async () => {
    const requests = stubFetch();
    const { result } = await run([
      agency("a-1", "Austin Police Department", "TX"),
      agency("a-2", "Example Police Department", "ZZ"),
      agency("a-3", "Dallas Police Department", "TX"),
    ]);
    await expect(result).rejects.toThrow(
      'net/clearinghouse/api: agency a-2 has a state the Clearinghouse has no ID for: "ZZ".',
    );
    expect(requests.map((url) => url.searchParams.get("text"))).toEqual([
      "Austin Police Department",
    ]);
  });

  it("writes one file for each of two agencies that share a name, named by the agency's source ID", async () => {
    stubFetch((url) => ({
      results: [
        { id: url.searchParams.get("state") === "5826" ? 11 : 22, name: "x" },
      ],
      next: null,
    }));
    const { sourceDir, result } = await run([
      agency("sa-il", "Springfield Police Department", "IL"),
      agency("sa/mo", "Springfield Police Department", "MO"),
    ]);
    await result;

    expect(
      (await readdir(sourceDir))
        .filter((f) => f.endsWith(".cases.json"))
        .sort(),
    ).toEqual(["sa%2Fmo.cases.json", "sa-il.cases.json"]);
    const file = async (name: string) =>
      JSON.parse(await readFile(path.join(sourceDir, name), "utf8"));
    const illinois = await file("sa-il.cases.json");
    expect(illinois.agency).toEqual({
      id: "sa-il",
      name: "Springfield Police Department",
      state: "IL",
    });
    expect(illinois.cases.map((c: { id: number }) => c.id)).toEqual([11]);
    const missouri = await file("sa%2Fmo.cases.json");
    expect(missouri.agency).toEqual({
      id: "sa/mo",
      name: "Springfield Police Department",
      state: "MO",
    });
    expect(missouri.cases.map((c: { id: number }) => c.id)).toEqual([22]);
  });

  it("counts a search whose response has no list of results as a failed search, and writes no file for the agency", async () => {
    stubFetch(() => ({ detail: "unexpected" }));
    const { sourceDir, logs, result } = await run([
      agency("a-1", "Austin Police Department", "TX"),
    ]);
    await result;
    expect(
      (await readdir(sourceDir)).filter((f) => f.endsWith(".cases.json")),
    ).toEqual([]);
    expect(logs.some((line) => line.includes("has no list of results"))).toBe(
      true,
    );
    expect(logs.at(-1)).toContain("1 skipped after errors");
  });
});
