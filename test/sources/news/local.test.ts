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
    search: async (a: { name: string }, nextPage?: string) => ({
      urls: Array.from(
        { length: 6 },
        (_, i) => a.name + "/" + (i + (nextPage ? 6 : 0)),
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
  expect(visited).toHaveLength(24);
  expect(new Set(visited).size).toBe(24);
});
