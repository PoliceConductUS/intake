import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { acquire } from "../../../sources/com/courtlistener/www/api/acquire.js";
import type { AcquireAgencyRecord } from "../../../src/cli/transform/source-transform.js";
import { createCourtListenerClient } from "../../../src/shared/services/courtlistener-client.js";
import {
  fakeFetch,
  harness,
  unusedServiceClients,
  type FakeAnswer,
  type Harness,
} from "../../shared/services/harness.js";

const DAY_MS = 86_400_000;

function hit(docketId: number, party: string[]) {
  return {
    docket_id: docketId,
    caseName: `Doe v. Agency ${docketId}`,
    docketNumber: `3:23-cv-${docketId}`,
    court_id: "txnd",
    dateFiled: "2023-04-01",
    dateTerminated: null,
    cause: "42:1983 Civil Rights Act",
    docket_absolute_url: `/docket/${docketId}/doe-v-agency/`,
    party,
  };
}

function agency(
  agencyId: string,
  name: string,
  state: string,
): AcquireAgencyRecord {
  return { agencyId, name, state, place: null, county: null };
}

function courtListener(
  search: (partyName: string, courts: string) => FakeAnswer,
) {
  return fakeFetch((url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/rest/v4/courts/")
      return { status: 200, body: JSON.stringify({ results: [] }) };
    return search(
      searchParams.get("party_name") ?? "",
      searchParams.get("court") ?? "",
    );
  });
}

const page = (results: unknown[]): FakeAnswer => ({
  status: 200,
  body: JSON.stringify({ results, next: null }),
});

async function run(
  h: Harness,
  web: ReturnType<typeof fakeFetch>,
  agencies: AcquireAgencyRecord[],
  options: {
    env?: Record<string, string>;
    deps?: Harness["deps"];
    maxRetries?: number;
  } = {},
) {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "courtlistener-out-"));
  const state = await mkdtemp(path.join(tmpdir(), "courtlistener-state-"));
  const lines: string[] = [];
  const settled = await Promise.allSettled([
    acquire({
      sourceDir,
      state,
      env: options.env ?? {},
      data: { agencies: async () => ({ items: agencies }) },
      logger: { info: (line) => lines.push(line) },
      clients: {
        ...unusedServiceClients(),
        courtListener: createCourtListenerClient({
          ...(options.deps ?? h.deps),
          fetch: web.fetch,
          readToken: () => "fixture-token",
          maxRetries: options.maxRetries ?? 0,
        }),
      },
    }),
  ]);
  const searches = web.calls
    .map((call) => new URL(call.url))
    .filter((url) => url.pathname !== "/api/rest/v4/courts/");
  return {
    error:
      settled[0].status === "rejected"
        ? (settled[0].reason as Error).message
        : undefined,
    files: (await readdir(sourceDir)).sort(),
    stateFiles: await readdir(state),
    read: async (name: string) =>
      JSON.parse(await readFile(path.join(sourceDir, name), "utf8")),
    searches,
    lines,
  };
}

describe("com/courtlistener/www/api acquire", () => {
  test("makes only searches and writes one dockets.json for each agency and nothing else", async () => {
    const h = await harness();
    const web = courtListener((partyName) =>
      page(
        partyName === "Irving Police Department"
          ? [hit(101, ["City of Irving", " John Smith "])]
          : [],
      ),
    );
    const result = await run(h, web, [
      agency("irving-1", "Irving Police Department", "TX"),
      agency("edina-1", "Edina Police Department", "MN"),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.searches.map((url) => url.pathname)).toEqual([
      "/api/rest/v4/search/",
      "/api/rest/v4/search/",
    ]);
    expect(result.files).toEqual([
      "edina-1.dockets.json",
      "irving-1.dockets.json",
    ]);
    expect(result.stateFiles).toEqual([]);
    expect(await result.read("irving-1.dockets.json")).toEqual({
      agency: {
        id: "irving-1",
        name: "Irving Police Department",
        state: "TX",
        county: "",
        place: "",
      },
      dockets: [
        {
          id: "101",
          case_name: "Doe v. Agency 101",
          docket_number: "3:23-cv-101",
          court: "txnd",
          date_filed: "2023-04-01",
          date_terminated: null,
          cause: "42:1983 Civil Rights Act",
          absolute_url: "/docket/101/doe-v-agency/",
          parties: ["City of Irving", "John Smith"],
        },
      ],
    });
    expect((await result.read("edina-1.dockets.json")).dockets).toEqual([]);
  });

  test("two agencies with one name in different states each keep their own file, named by the agency's source ID", async () => {
    const h = await harness();
    const web = courtListener((_partyName, courts) =>
      page([
        hit(courts.includes("ilcd") ? 201 : 301, ["Springfield", "Ann Lee"]),
      ]),
    );
    const result = await run(h, web, [
      agency("il/springfield", "Springfield Police Department", "IL"),
      agency("mo/springfield", "Springfield Police Department", "MO"),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([
      "il%2Fspringfield.dockets.json",
      "mo%2Fspringfield.dockets.json",
    ]);
    const illinois = await result.read("il%2Fspringfield.dockets.json");
    const missouri = await result.read("mo%2Fspringfield.dockets.json");
    expect(illinois.agency).toMatchObject({
      id: "il/springfield",
      state: "IL",
    });
    expect(illinois.dockets.map((docket: { id: string }) => docket.id)).toEqual(
      ["201"],
    );
    expect(missouri.agency).toMatchObject({
      id: "mo/springfield",
      state: "MO",
    });
    expect(missouri.dockets.map((docket: { id: string }) => docket.id)).toEqual(
      ["301"],
    );
  });

  test("an agency with a blank name stops the acquire, naming the agency, before any later agency is searched", async () => {
    const h = await harness();
    const web = courtListener(() => page([]));
    const result = await run(h, web, [
      agency("first", "First Police Department", "TX"),
      agency("nameless-7", "   ", "TX"),
      agency("later", "Later Police Department", "TX"),
    ]);

    expect(result.error).toBe(
      "com/courtlistener/www/api: agency nameless-7 has no name.",
    );
    expect(
      result.searches.map((url) => url.searchParams.get("party_name")),
    ).toEqual(["First Police Department"]);
    expect(result.files).toEqual(["first.dockets.json"]);
  });

  test("an agency in a state with no court list stops the acquire, naming the agency, before any later agency is searched", async () => {
    const h = await harness();
    const web = courtListener(() => page([]));
    const result = await run(h, web, [
      agency("samoa-3", "Pago Pago Police Department", "AS"),
      agency("later", "Later Police Department", "TX"),
    ]);

    expect(result.error).toBe(
      'com/courtlistener/www/api: agency samoa-3 is in state "AS", which has no court list.',
    );
    expect(result.searches).toEqual([]);
    expect(result.files).toEqual([]);
  });

  test.each(["abc", "", "2022.5"])(
    "COURTLISTENER_MIN_YEAR %j is not a year and stops the acquire before any request",
    async (setting) => {
      const h = await harness();
      const web = courtListener(() => page([]));
      const result = await run(
        h,
        web,
        [agency("first", "First Police Department", "TX")],
        { env: { COURTLISTENER_MIN_YEAR: setting } },
      );

      expect(result.error).toBe(
        `com/courtlistener/www/api: COURTLISTENER_MIN_YEAR is not a year: ${JSON.stringify(setting)}.`,
      );
      expect(web.calls).toEqual([]);
    },
  );

  test("COURTLISTENER_MIN_YEAR sets the earliest filing date searched, and 2022 is used when it is not set", async () => {
    const agencies = [agency("first", "First Police Department", "TX")];
    const unset = courtListener(() => page([]));
    await run(await harness(), unset, agencies);
    const set = courtListener(() => page([]));
    await run(await harness(), set, agencies, {
      env: { COURTLISTENER_MIN_YEAR: "2019" },
    });

    const filedAfter = (web: ReturnType<typeof fakeFetch>) =>
      web.calls
        .map((call) => new URL(call.url).searchParams.get("filed_after"))
        .filter((value) => value !== null);
    expect(filedAfter(unset)).toEqual(["2022-01-01"]);
    expect(filedAfter(set)).toEqual(["2019-01-01"]);
  });

  test("a search is asked again only after 120 days", async () => {
    const h = await harness();
    const agencies = [agency("first", "First Police Department", "TX")];
    const first = courtListener(() => page([hit(401, ["Ann Lee"])]));
    await run(h, first, agencies);

    h.advance(119 * DAY_MS);
    const within = courtListener(() => page([]));
    const cached = await run(h, within, agencies, { deps: h.nextCommand() });
    expect(within.calls).toEqual([]);
    expect(
      (await cached.read("first.dockets.json")).dockets.map(
        (docket: { id: string }) => docket.id,
      ),
    ).toEqual(["401"]);

    h.advance(2 * DAY_MS);
    const after = courtListener(() => page([hit(402, ["Ann Lee"])]));
    const refreshed = await run(h, after, agencies, { deps: h.nextCommand() });
    expect(refreshed.searches).toHaveLength(1);
    expect(
      (await refreshed.read("first.dockets.json")).dockets.map(
        (docket: { id: string }) => docket.id,
      ),
    ).toEqual(["402"]);
  });

  test("a search result with no docket ID stops the acquire, naming the agency and the party searched", async () => {
    const h = await harness();
    const web = courtListener(() =>
      page([{ ...hit(501, ["Ann Lee"]), docket_id: null }]),
    );
    const result = await run(h, web, [
      agency("first", "First Police Department", "TX"),
    ]);

    expect(result.error).toBe(
      'com/courtlistener/www/api: a search result for agency first (party "First Police Department") has no docket ID.',
    );
    expect(result.files).toEqual([]);
  });

  test("a search that fails for one agency writes no file for it, says so, and the next agency is searched", async () => {
    const h = await harness();
    const web = courtListener((partyName) =>
      partyName === "Odd Police Department"
        ? { status: 400, body: "{}" }
        : page([hit(601, ["Ann Lee"])]),
    );
    const result = await run(h, web, [
      agency("odd", "Odd Police Department", "TX"),
      agency("next", "Next Police Department", "TX"),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.files).toEqual(["next.dockets.json"]);
    expect(result.lines).toContainEqual(
      expect.stringMatching(
        /^com\/courtlistener\/www\/api: Odd Police Department \(odd\): no dockets file written, because the search for party "Odd Police Department" failed \(HTTP 400 for /,
      ),
    );
    expect(result.lines.at(-1)).toBe(
      "com/courtlistener/www/api: 1 agencies written, 1 left out after a failed search, 0 left out while CourtListener was down.",
    );
  });

  test("when CourtListener goes down during the run, the agencies not yet searched get no file and are counted", async () => {
    const h = await harness();
    const web = courtListener((partyName) =>
      partyName === "First Police Department"
        ? page([hit(701, ["Ann Lee"])])
        : { status: 503, body: "" },
    );
    const result = await run(h, web, [
      agency("first", "First Police Department", "TX"),
      agency("second", "Second Police Department", "TX"),
      agency("third", "Third Police Department", "TX"),
    ]);

    expect(result.error).toBeUndefined();
    expect(result.files).toEqual(["first.dockets.json"]);
    expect(
      result.searches.map((url) => url.searchParams.get("party_name")),
    ).toEqual(["First Police Department", "Second Police Department"]);
    expect(result.lines.at(-1)).toBe(
      "com/courtlistener/www/api: 1 agencies written, 0 left out after a failed search, 2 left out while CourtListener was down.",
    );
  });
});
