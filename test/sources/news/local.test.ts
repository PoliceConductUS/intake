import { expect, it } from "vitest";
import { sweepNews } from "../../../sources/org.policeconduct.local-news/sweep.js";
it("finishes the interrupted agency before opening the next and does not cap URLs", async () => {
  const visited: string[] = [];
  let saved: any;
  let fail = true;
  const deps = {
    agencies: async (cursor?: string) => ({
      items: [{ agencyId: cursor ?? "a", name: cursor ?? "a" }],
      nextCursor: cursor ? undefined : "b",
    }),
    officers: async () => ["Dana Reyes"],
    search: async (query: string, nextPage?: string) => ({
      urls: Array.from(
        { length: 6 },
        (_, i) => query + "/" + (i + (nextPage ? 6 : 0)),
      ),
      nextPage: nextPage ? undefined : "page2",
    }),
    visit: async (url: string) => {
      if (fail && url === "a/10") throw Error("interrupt");
      visited.push(url);
    },
    save: async (state: unknown) => {
      saved = structuredClone(state);
    },
  };
  await expect(sweepNews(undefined, deps)).rejects.toThrow("interrupt");
  fail = false;
  await sweepNews(saved, deps);
  expect(visited).toHaveLength(48);
  expect(new Set(visited).size).toBe(48);
});

it("searches the agency and each officer before the next agency, resuming the interrupted officer page", async () => {
  const queries: string[] = [];
  let saved:
    | import("../../../sources/org.policeconduct.local-news/sweep.js").SweepPosition
    | undefined;
  let interrupt = true;
  const deps = {
    agencies: async (cursor?: string) => ({
      items: [
        {
          agencyId: cursor ?? "one",
          name: cursor ? "Empty Agency" : "First Agency",
        },
      ],
      nextCursor: cursor ? undefined : "two",
    }),
    officers: async (id: string) =>
      id === "one" ? ["Dana Reyes", "Taylor Bell"] : [],
    search: async (query: string, nextPage?: string) => {
      queries.push(query + (nextPage ?? ""));
      return {
        urls: [query + (nextPage ?? "")],
        nextPage: !nextPage && query.startsWith('"Dana') ? "/2" : undefined,
      };
    },
    visit: async (url: string) => {
      if (interrupt && url.endsWith("/2")) throw Error("interrupted");
    },
    save: async (position: NonNullable<typeof saved>) => {
      saved = structuredClone(position);
    },
  };
  await expect(sweepNews(undefined, deps)).rejects.toThrow("interrupted");
  interrupt = false;
  await sweepNews(saved, deps);
  expect(queries).toEqual([
    "First Agency",
    '"Dana Reyes" "First Agency"',
    '"Dana Reyes" "First Agency"/2',
    '"Taylor Bell" "First Agency"',
  ]);
  expect(saved?.complete).toBe(true);
});

it("restarts the officer list with first and last names when resuming an unquoted search", async () => {
  const agency = { agencyId: "one", name: "Example Police Department" };
  const previous = {
    agency,
    officers: ["Dana Lee Reyes Jr.", "Taylor B Bell"],
    queryIndex: 2,
    urls: ["old-search-result"],
    nextPage: "old-search-page",
    index: 0,
  };
  const searchTerms: string[] = [];
  await sweepNews(previous, {
    agencies: async () => {
      throw Error("Agency search already finished");
    },
    officers: async () => ["Dana Reyes", "Taylor Bell"],
    search: async (term, nextPage) => {
      expect(nextPage).toBeUndefined();
      searchTerms.push(term);
      return { urls: [] };
    },
    visit: async () => {
      throw Error("Unexpected cached result");
    },
    save: async () => {},
  });
  expect(searchTerms).toEqual([
    '"Dana Reyes" "Example Police Department"',
    '"Taylor Bell" "Example Police Department"',
  ]);
});
