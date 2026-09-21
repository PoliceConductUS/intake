import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { acquire } from "../../../sources/us-census-gazetteer/acquire.js";
import { discoverLatestGazetteerLinks } from "../../../sources/us-census-gazetteer/acquire/discovery.js";
import { gazetteerSourceUrls } from "../../../sources/us-census-gazetteer/acquire/download.js";

const pageUrl =
  "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html";
const tigerIndex = "https://www2.census.gov/geo/tiger/";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const anchor = (url: string) => `<a href="${url}">${url}</a>`;
function gazetteer(year: string) {
  return ["state", "counties", "place"]
    .map((kind) =>
      anchor(
        `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_${kind}_national.zip`,
      ),
    )
    .join("");
}

async function run(
  options: {
    tigerYear?: string;
    omit?: string;
    status?: number;
    yearPageMismatch?: boolean;
  } = {},
) {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "census-acquire-"));
  directories.push(sourceDir);
  const year = options.tigerYear ?? "2025";
  const selectedPage = pageUrl.replace(".html", `.${year}.html`);
  const publishedUrls = gazetteerSourceUrls(
    discoverLatestGazetteerLinks(gazetteer(year), selectedPage),
  );
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(url);
    if (url === pageUrl)
      return new Response(
        gazetteer("2026") + anchor(pageUrl.replace(".html", ".2025.html#year")),
      );
    if (url === tigerIndex)
      return new Response(
        anchor(`TIGER${year}/`) +
          anchor("TGRGDB26/") +
          anchor("TIGER2026-not-a-release/"),
        { status: options.status ?? 200 },
      );
    if (url === selectedPage)
      return new Response(gazetteer(options.yearPageMismatch ? "2026" : year));
    if (url.endsWith("/"))
      return new Response(
        publishedUrls
          .filter(
            (file) =>
              file.startsWith(url) &&
              !file.includes(options.omit ?? "NO_OMISSION"),
          )
          .map(anchor)
          .join(""),
      );
    if (publishedUrls.includes(url) || url.includes("/2026_Gazetteer/"))
      return new Response(`source:${url}`);
    return new Response("Not published", { status: 404 });
  });
  const messages: string[] = [];
  let error: unknown;
  try {
    await acquire({
      sourceDir,
      state: sourceDir,
      env: {},
      data: {} as never,
      logger: { info: (message: string) => messages.push(message) },
    });
  } catch (caught) {
    error = caught;
  }
  return { files: await readdir(sourceDir), error, requested, messages };
}

test("acquires a complete matching 2025 set when the Gazetteer has advanced to 2026", async () => {
  const result = await run();
  expect(result.error).toBeUndefined();
  expect(result.files).toHaveLength(114);
  expect(result.files.every((file) => file.includes("2025"))).toBe(true);
  expect(result.files).toContain("tl_2025_27_cousub.zip");
  expect(result.files).toContain("tl_2025_48_place.zip");
  expect(result.requested.some((url) => url.includes("TIGER2026/"))).toBe(
    false,
  );
  expect(result.messages).toContain("census: 2025 — 114 source files");
});

test("automatically uses 2026 when both Gazetteer and TIGER publish it", async () => {
  const result = await run({ tigerYear: "2026" });
  expect(result.error).toBeUndefined();
  expect(result.files).toHaveLength(114);
  expect(result.files.every((file) => file.includes("2026"))).toBe(true);
});

test.each([
  { omit: "tl_2025_27_cousub.zip" },
  { tigerYear: "2024" },
  { status: 503 },
  { yearPageMismatch: true },
])(
  "fails before ZIP downloads for an unavailable release: %j",
  async (options) => {
    const result = await run(options);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.files).toEqual([]);
    expect(result.requested.filter((url) => url.endsWith(".zip"))).toEqual([]);
  },
);
