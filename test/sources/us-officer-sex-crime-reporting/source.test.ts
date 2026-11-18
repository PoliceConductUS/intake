import { expect, it, vi } from "vitest";
import {
  readSpreadsheet,
  spreadsheets,
} from "../../../sources/org/psvproject/arrest-tracker/spreadsheet.js";
import {
  acquire,
  acquireArticles,
} from "../../../sources/org/psvproject/arrest-tracker/acquire.js";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { transform } from "../../../sources/org/psvproject/arrest-tracker/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";
import {
  articleText,
  digest,
} from "../../../sources/org/psvproject/arrest-tracker/acquire.js";
import { unusedServiceClients } from "../../shared/services/harness.js";

it("retains reporting when a page also has an article element for weather alerts", () => {
  expect(
    articleText(
      Buffer.from(
        "<article>Weather alert</article><article>Officer John Smith worked for Example Police Department.</article>",
      ),
    ).text,
  ).toContain("John Smith");
});

it("rejects a non-workbook response before saving it as the annual source", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "officer-workbook-"));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("<html>Sign in</html>"));
  try {
    await expect(
      acquire({
        clients: unusedServiceClients(),
        sourceDir: dir,
        state: dir,
        env: {},
        data: { agencies: vi.fn() },
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    await expect(
      readFile(path.join(dir, String(spreadsheets[0].year), "source.xlsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("preserves every named entry, investigation-only link, and actual hyperlink", async () => {
  const file = await openAsBlob(
    "sources/org/psvproject/arrest-tracker/2026-10-15.xlsx",
  );
  const rows = await readSpreadsheet(await file.arrayBuffer());
  const linked = rows.filter((r) => r.url !== null);
  expect(linked).toHaveLength(354);
  expect(linked.filter((r) => r.name !== "")).toHaveLength(345);
  expect(
    rows.filter((r) => r.url === null).map((r) => [r.row, r.name, r.state]),
  ).toEqual([
    [351, "Year to Date: 345", ""],
    [353, "Investigation Without Outcome:", ""],
  ]);
  expect(rows.find((r) => r.row === 361)).toMatchObject({
    name: "",
    url: "http://news5cleveland.com/news/local-news/akron-canton-news/officer-who-fatally-shot-jazmir-tucker-under-investigation-for-sexual-assault-allegations",
  });
  expect(rows[0]).toMatchObject({
    row: 4,
    name: "Richard Johnson",
    state: "AK",
  });
});

it("links only article-supported identities and reports unresolved officers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "officer-transform-"));
  const body = "Officer John Smith worked for Example Police Department.";
  await writeFile(path.join(dir, "article.html"), body);
  await writeFile(path.join(dir, "article.txt"), body);
  await writeFile(
    path.join(dir, "articles.json"),
    JSON.stringify([
      {
        url: "https://example.com/article",
        status: 200,
        error: null,
        title: "Report",
        sha256: digest(body),
        bodyFile: "article.html",
        textFile: "article.txt",
      },
    ]),
  );
  await writeFile(
    path.join(dir, "spreadsheet.json"),
    JSON.stringify({
      url: spreadsheets[1].url,
      rows: [
        {
          row: 4,
          name: "John Smith",
          state: "TX",
          url: "https://example.com/article",
        },
      ],
    }),
  );
  await writeFile(
    path.join(dir, "reviewed.json"),
    JSON.stringify([
      {
        url: "https://example.com/article",
        sha256: digest(body),
        officers: [
          {
            name: "John Smith",
            agency: "Example Police Department",
            state: "TX",
            passages: [body],
          },
        ],
      },
    ]),
  );
  const data = {
    resolveAgency: async () => ({
      agencyId: "agency-1",
      location: {
        address: "1 Main St",
        city: "Example",
        state: "TX",
        zipCode: "75001",
      },
    }),
    resolvePersonnel: async () => ({ agencyPersonnelId: "officer-1" }),
  };
  const args = {
    paths: [
      path.join(dir, "spreadsheet.json"),
      path.join(dir, "articles.json"),
      path.join(dir, "articles", "nested.html"),
    ],
    state: dir,
    emit: async () => {},
    readXlsx,
    data,
  };
  const result = await transform(args);
  expect(Object.values(result.artifacts[1].records)[0].spec).toMatchObject({
    agency_personnel_id: "officer-1",
  });
  const older = path.join(dir, "2025", "spreadsheet.json");
  await mkdir(path.dirname(older));
  await writeFile(
    older,
    JSON.stringify({
      url: spreadsheets[0].url,
      rows: [{ row: 9, state: "TX", url: "https://example.com/article" }],
    }),
  );
  expect(
    new Set(spreadsheets.map((sheet) => new URL(sheet.url).pathname)).size,
  ).toBe(2);
  const combined = await transform({ ...args, paths: [...args.paths, older] });
  const records = Object.values(combined.artifacts[0].records);
  expect(records).toHaveLength(1);
  for (const [sheet, row] of [
    [spreadsheets[0], 9],
    [spreadsheets[1], 4],
  ] as const) {
    expect(records[0]).toMatchObject({
      spec: {
        notes: expect.stringContaining(`${sheet.url}; GENERAL rows ${row}`),
      },
    });
  }
  const unresolved = await transform({
    ...args,
    data: { ...data, resolvePersonnel: async () => null },
  });
  expect(unresolved.artifacts[1].records).toEqual({});
  expect(
    await readFile(path.join(dir, "mapping-report.json"), "utf8"),
  ).toContain("officer-unresolved");
  const wrongState = await transform({
    ...args,
    data: {
      ...data,
      resolveAgency: async () => ({
        agencyId: "wrong-state",
        location: {
          address: "1 Main St",
          city: "Example",
          state: "MA",
          zipCode: "01001",
        },
      }),
    },
  });
  expect(wrongState.artifacts[1].records).toEqual({});
  await writeFile(path.join(dir, "article.html"), "Changed source");
  await expect(transform(args)).rejects.toThrow("digest");
});

it("retains rejected article responses and extracts successful article evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "officer-articles-"));
  const results = await acquireArticles(
    ["https://example.com/ok", "https://example.com/denied"],
    dir,
    async (url) =>
      url.endsWith("ok")
        ? new Response(
            "<html><title>Article</title><article>Officer John Smith works for Example Police Department.</article></html>",
          )
        : new Response("Access denied", { status: 403 }),
  );
  expect(results[0]).toMatchObject({
    status: 200,
    title: "Article",
    error: null,
  });
  expect(
    await readFile(path.join(dir, results[0].textFile!), "utf8"),
  ).toContain("John Smith");
  expect(results[1]).toMatchObject({ status: 403, error: "HTTP 403" });
  expect(await readFile(path.join(dir, results[1].bodyFile!), "utf8")).toBe(
    "Access denied",
  );
});

it("saves a row with an empty link cell and requests no article for it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "officer-acquire-"));
  const workbook = await readFile(
    "sources/org/psvproject/arrest-tracker/2026-10-15.xlsx",
  );
  const requested: string[] = [];
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      const url = String(input);
      requested.push(url);
      return url.startsWith("https://docs.google.com/")
        ? new Response(workbook)
        : new Response("Not found", { status: 404 });
    });
  try {
    await acquire({
      clients: unusedServiceClients(),
      sourceDir: dir,
      state: dir,
      env: {},
      data: { agencies: vi.fn() },
    });
    const sheet = JSON.parse(
      await readFile(path.join(dir, "2026", "spreadsheet.json"), "utf8"),
    );
    expect(
      sheet.rows.find((row: { row: number }) => row.row === 351),
    ).toMatchObject({ name: "Year to Date: 345", url: null });
    // The 2026-10-15 workbook holds 350 distinct article URLs; the same
    // workbook is served for both years here.
    expect(
      requested.filter((url) => !url.startsWith("https://docs.google.com/")),
    ).toHaveLength(350);
    expect(
      JSON.parse(await readFile(path.join(dir, "articles.json"), "utf8")),
    ).toHaveLength(350);
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

type FixtureRow = {
  row: number;
  name: string;
  state: string;
  url: string | null;
};

async function trackerFixture(input: {
  rows: FixtureRow[];
  articles: Array<{ url: string; body: string | null }>;
  reviews: Array<{ url: string; officers: string[] }>;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "officer-outcomes-"));
  const bodies = new Map(input.articles.map((a) => [a.url, a.body]));
  await writeFile(
    path.join(dir, "articles.json"),
    JSON.stringify(
      await Promise.all(
        input.articles.map(async ({ url, body }, index) => {
          if (body === null)
            return {
              url,
              status: 404,
              error: "HTTP 404",
              title: null,
              sha256: null,
              bodyFile: null,
              textFile: null,
            };
          await writeFile(path.join(dir, `${index}.html`), body);
          return {
            url,
            status: 200,
            error: null,
            title: "Report",
            sha256: digest(body),
            bodyFile: `${index}.html`,
            textFile: `${index}.txt`,
          };
        }),
      ),
    ),
  );
  await writeFile(
    path.join(dir, "spreadsheet.json"),
    JSON.stringify({
      url: spreadsheets[1].url,
      rows: input.rows.map((row) => ({
        title: "Officer",
        category: "SA",
        outcome: "Arrest",
        linkText: row.url ?? "",
        ...row,
      })),
    }),
  );
  await writeFile(
    path.join(dir, "reviewed.json"),
    JSON.stringify(
      input.reviews.map(({ url, officers }) => ({
        url,
        sha256: digest(bodies.get(url) ?? ""),
        officers: officers.map((name) => ({
          name,
          agency: "Example Police Department",
          state: "TX",
          passages: [name],
        })),
      })),
    ),
  );
  return {
    dir,
    run: () =>
      transform({
        paths: [
          path.join(dir, "spreadsheet.json"),
          path.join(dir, "articles.json"),
        ],
        state: dir,
        emit: async () => {},
        readXlsx,
        data: {
          resolveAgency: async () => ({
            agencyId: "agency-1",
            location: {
              address: "1 Main St",
              city: "Example",
              state: "TX",
              zipCode: "75001",
            },
          }),
          resolvePersonnel: async ({ personnelName }) =>
            personnelName === "John Smith"
              ? { agencyPersonnelId: "officer-1" }
              : null,
        },
      }),
  };
}

const mapped = "https://example.com/mapped";

it("gives every workbook row one outcome and reports a row with an empty link cell on its state's licensing authority", async () => {
  const { dir, run } = await trackerFixture({
    rows: [
      { row: 4, name: "John Smith", state: "TX", url: mapped },
      { row: 5, name: "Ann Lee", state: "MN", url: null },
      { row: 6, name: "Bo Diaz", state: "TX", url: "https://example.com/gone" },
      { row: 7, name: "Cy Ford", state: "OR", url: "https://example.com/new" },
      { row: 8, name: "Di Hall", state: "TX", url: "https://example.com/none" },
      {
        row: 9,
        name: "Mary Jones",
        state: "TX",
        url: "https://example.com/unknown",
      },
      { row: 10, name: "", state: "", url: mapped },
    ],
    articles: [
      { url: mapped, body: "Officer John Smith was arrested." },
      { url: "https://example.com/gone", body: null },
      { url: "https://example.com/new", body: "Not yet reviewed." },
      { url: "https://example.com/none", body: "An unnamed officer." },
      { url: "https://example.com/unknown", body: "Officer Mary Jones." },
    ],
    reviews: [
      { url: mapped, officers: ["John Smith"] },
      { url: "https://example.com/none", officers: [] },
      { url: "https://example.com/unknown", officers: ["Mary Jones"] },
    ],
  });
  try {
    const result = await run();
    expect(result.accounting).toEqual([
      {
        input: "GENERAL rows",
        read: 7,
        emitted: 2,
        reported: 1,
        notSelected: {
          "article could not be retrieved": 1,
          "article not reviewed": 1,
          "article supports no officer identity": 1,
          "names no officer the database knows": 1,
        },
      },
    ]);
    expect(
      Object.fromEntries(result.artifacts.map((a) => [a.kind, a.records]))
        .LicensingAuthorities,
    ).toEqual({
      tx: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/tx/" } },
          defects: [],
        },
        spec: {},
      },
      mn: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/mn/" } },
          defects: [
            {
              code: "tracker-entry-without-link",
              type: "warning",
              field: "coverage_links",
              value: {
                name: "Ann Lee",
                title: "Officer",
                state: "MN",
                category: "SA",
                outcome: "Arrest",
              },
              message:
                "The Police Sexual Violence Project arrest tracker lists Ann Lee in MN with no link to a news report, so the entry is not listed here.",
              evidence: [
                { workbook: spreadsheets[1].url, sheet: "GENERAL", row: 5 },
              ],
              source_namespace: "org/psvproject/arrest-tracker",
              source_record_id: "spreadsheet.json#5",
            },
          ],
        },
        spec: {},
      },
      or: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/or/" } },
          defects: [],
        },
        spec: {},
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("throws naming a row with an empty link cell that names no state", async () => {
  const { dir, run } = await trackerFixture({
    rows: [
      { row: 4, name: "John Smith", state: "TX", url: mapped },
      { row: 351, name: "Year to Date: 345", state: "", url: null },
    ],
    articles: [{ url: mapped, body: "Officer John Smith was arrested." }],
    reviews: [{ url: mapped, officers: ["John Smith"] }],
  });
  try {
    await expect(run()).rejects.toThrow(
      'org/psvproject/arrest-tracker: spreadsheet.json GENERAL row 351 has an empty link cell and names no state: "Year to Date: 345"',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("throws on a reviewed.json entry whose URL is not in articles.json", async () => {
  const { dir, run } = await trackerFixture({
    rows: [{ row: 4, name: "John Smith", state: "TX", url: mapped }],
    articles: [{ url: mapped, body: "Officer John Smith was arrested." }],
    reviews: [
      { url: mapped, officers: ["John Smith"] },
      { url: "https://example.com/removed", officers: [] },
    ],
  });
  try {
    await expect(run()).rejects.toThrow(
      "org/psvproject/arrest-tracker: reviewed.json entry is not in articles.json: https://example.com/removed",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("throws on a row whose article is not in articles.json and on an article no row cites", async () => {
  const uncited = await trackerFixture({
    rows: [{ row: 4, name: "John Smith", state: "TX", url: mapped }],
    articles: [
      { url: mapped, body: "Officer John Smith was arrested." },
      { url: "https://example.com/uncited", body: null },
    ],
    reviews: [],
  });
  const missing = await trackerFixture({
    rows: [
      { row: 4, name: "John Smith", state: "TX", url: mapped },
      {
        row: 5,
        name: "Ann Lee",
        state: "MN",
        url: "https://example.com/absent",
      },
    ],
    articles: [{ url: mapped, body: "Officer John Smith was arrested." }],
    reviews: [],
  });
  try {
    await expect(uncited.run()).rejects.toThrow(
      "org/psvproject/arrest-tracker: no workbook row cites the article https://example.com/uncited",
    );
    await expect(missing.run()).rejects.toThrow(
      "org/psvproject/arrest-tracker: spreadsheet.json GENERAL row 5 cites an article that is not in articles.json: https://example.com/absent",
    );
  } finally {
    await rm(uncited.dir, { recursive: true, force: true });
    await rm(missing.dir, { recursive: true, force: true });
  }
});
