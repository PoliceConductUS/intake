import { expect, it } from "vitest";
import { readSpreadsheet } from "../../../sources/us-officer-sex-crime-reporting/spreadsheet.js";
import { acquireArticles } from "../../../sources/us-officer-sex-crime-reporting/acquire.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { transform } from "../../../sources/us-officer-sex-crime-reporting/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";
import {
  articleText,
  digest,
} from "../../../sources/us-officer-sex-crime-reporting/acquire.js";

it("retains reporting when a page also has an article element for weather alerts", () => {
  expect(
    articleText(
      Buffer.from(
        "<article>Weather alert</article><article>Officer John Smith worked for Example Police Department.</article>",
      ),
    ).text,
  ).toContain("John Smith");
});

it("preserves every named entry, investigation-only link, and actual hyperlink", async () => {
  const rows = await readSpreadsheet(
    "sources/us-officer-sex-crime-reporting/2026-10-15.xlsx",
  );
  expect(rows).toHaveLength(354);
  expect(rows.filter((r) => r.name !== "")).toHaveLength(345);
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
      rows: [
        { row: 4, name: "John Smith", url: "https://example.com/article" },
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
