import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { acquire } from "../../../sources/courtlistener/acquire.js";
import { transform } from "../../../sources/courtlistener/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";
const { analyze } = vi.hoisted(() => ({
  analyze: vi.fn(async () => ({
    paragraphs: [
      { text: "The plaintiff alleges an unlawful detention.", pages: [1] },
    ],
  })),
}));
vi.mock("../../../sources/courtlistener/summary-analysis.js", () => ({
  createComplaintAnalyzer: () => ({
    model: "synthetic",
    promptVersion: "test",
    analyze,
  }),
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  analyze.mockClear();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
test("ordinary acquire enriches a cached docket and transform replays the saved summary offline", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "acquire-summary-"));
  dirs.push(root);
  const state = path.join(root, "state");
  const sourceDir = path.join(root, "source");
  await mkdir(state);
  await writeFile(
    path.join(state, "docket-cache.json"),
    JSON.stringify({
      agencies: {
        "example-police": {
          lastSearchedAt: new Date().toISOString(),
          dockets: [
            {
              id: "12",
              case_name: "Doe v Example",
              court: "mnd",
              date_filed: "2025-01-01",
              docket_number: "0:25-cv-001",
              parties: ["John Smith"],
              cause: "legacy cause code",
              absolute_url: "/docket/12/",
            },
          ],
        },
      },
    }),
  );
  const pdf = Buffer.from("%PDF-1.7 synthetic");
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith("https://storage.courtlistener.com")) {
      expect(options?.headers).toBeUndefined();
      return new Response(pdf);
    }
    expect(url).toContain("/docket-entries/");
    return Response.json({
      results: [
        {
          entry_number: 1,
          date_filed: "2025-01-01",
          recap_documents: [
            {
              id: 123,
              document_number: "1",
              description: "COMPLAINT",
              is_available: true,
              filepath_local: "recap/example.pdf",
              sha1: createHash("sha1").update(pdf).digest("hex"),
              plain_text: "One page of complaint facts.",
              absolute_url: "/docket/12/1/",
            },
          ],
        },
      ],
      next: null,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  await acquire({
    sourceDir,
    state,
    env: { COURT_LISTENER_API_TOKEN: "synthetic" },
    data: {
      agencies: async () => ({
        items: [
          {
            agencyId: "a1",
            name: "Example Police",
            state: "MN",
            place: null,
            county: null,
          },
        ],
      }),
    },
  });
  expect(analyze).toHaveBeenCalledTimes(1);
  const file = path.join(sourceDir, "example-police.dockets.json");
  const acquired = JSON.parse(await readFile(file, "utf8"));
  vi.stubGlobal("fetch", () => {
    throw new Error("Transform must not fetch");
  });
  const deps = {
    paths: [file],
    state,
    readXlsx,
    emit: async () => {},
    data: {
      resolvePersonnel: async () => ({ agencyPersonnelId: "officer-1" }),
    },
  };
  const first = await transform(deps);
  const second = await transform(deps);
  expect(second).toEqual(first);
  const cases = first.artifacts.find((a) => a.kind === "CivilCases")!;
  expect(cases.records["mnd:0:25-cv-001"].spec).toMatchObject({
    ai_complaint_summary: acquired.dockets[0].ai_complaint_summary,
    complaint_summary_unavailability: null,
  });
  expect(analyze).toHaveBeenCalledTimes(1);
});
