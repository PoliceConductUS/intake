import { describe, expect, it, vi } from "vitest";
import {
  createDocumentFetcher,
  isPublicContentLink,
  publicContentDownloadUrl,
} from "../../../../sources/mn-post/acquire/document-fetch.js";

const PAGE_URL =
  "https://mnitservices.my.salesforce.com/sfc/p/40000000N34b/a/cr000005TZ4L/iKCiIn3RberMIga8JemP4UBVgyqQb9VFA3gIdBOWKmU";

// The rendered content-delivery page, as the site serves it: page renditions
// carry the file version id the download endpoint needs.
const RENDERED_HTML = `<img src="https://mnitservices.my.salesforce.com/sfc/dist/version/renditionDownload?rendition=SVGZ&amp;versionId=068t000000gmlBH&amp;operationContext=DELIVERY&amp;contentId=05Tt000003G5xBV&amp;page=0&amp;d=/a/cr000005TZ4L/iKCiIn3RberMIga8JemP4UBVgyqQb9VFA3gIdBOWKmU&amp;oid=00D40000000N34b&amp;dpt=null&amp;viewId=">`;

describe("isPublicContentLink", () => {
  it("tells a public content-delivery page from a direct version download", () => {
    expect(isPublicContentLink(PAGE_URL)).toBe(true);
    expect(
      isPublicContentLink(
        "https://mnitservices.file.force.com/sfc/dist/version/download/?oid=00D40000000N34b&ids=068cr00000eArX7&d=%2Fa%2Fcr000006j3sj%2Ftoken&asPdf=false",
      ),
    ).toBe(false);
  });
});

describe("publicContentDownloadUrl", () => {
  it("derives the direct download URL from the page URL and the rendered version id", () => {
    expect(publicContentDownloadUrl(PAGE_URL, RENDERED_HTML)).toBe(
      "https://mnitservices.my.salesforce.com/sfc/dist/version/download/?oid=00D40000000N34b&ids=068t000000gmlBH&d=%2Fa%2Fcr000005TZ4L%2FiKCiIn3RberMIga8JemP4UBVgyqQb9VFA3gIdBOWKmU&asPdf=false",
    );
  });

  it("fails loud when the page rendered no file version", () => {
    expect(() =>
      publicContentDownloadUrl(
        PAGE_URL,
        "<html>Unable to Process Request</html>",
      ),
    ).toThrow(/could not derive a download URL/);
  });
});

const LEGACY_URL =
  "https://mnitservices--c.documentforce.com/sfc/dist/version/download/?oid=00D40000000N34b&ids=068t000000edRs9&d=%2Fa%2Ft0000002eEYg%2FsTyt2TLhjQvvtFdNdKzILXIoDZ4MpLcEQ9yZ1vhigIk&asPdf=false";
const CURRENT_URL = LEGACY_URL.replace(
  "mnitservices--c.documentforce.com",
  "mnitservices.file.force.com",
);
function fetcher(status = 200) {
  const get = vi.fn(async (_url: string, _options: unknown) => ({
    status: () => status,
    ok: () => status === 200,
    body: async () => Buffer.from("%PDF-test"),
    headers: () => ({ "content-type": "application/pdf" }),
  }));
  const context = {
    request: { get },
  } as unknown as import("playwright").BrowserContext;
  return { get, download: createDocumentFetcher({ context }) };
}
it("requests the current content hostname once with the exact source path and query", async () => {
  const f = fetcher();
  expect(await f.download(LEGACY_URL)).toMatchObject({ kind: "pdf" });
  expect(f.get.mock.calls.map((call) => call[0])).toEqual([CURRENT_URL]);
  expect(new URL(CURRENT_URL).search).toBe(new URL(LEGACY_URL).search);
});
it("keeps genuine mapped 404 responses unavailable without another host request", async () => {
  const f = fetcher(404);
  expect(await f.download(LEGACY_URL)).toEqual({
    kind: "unavailable",
    reason: "the site returned 404",
  });
  expect(f.get.mock.calls.map((call) => call[0])).toEqual([CURRENT_URL]);
});
it("preserves the source URL in acquired document evidence after transport mapping", async () => {
  const { mkdtemp, mkdir, writeFile, readdir, readFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { default: path } = await import("node:path");
  const root = await mkdtemp(path.join(tmpdir(), "source-url-provenance-"));
  try {
    const sourceDir = path.join(root, "source");
    await mkdir(path.join(sourceDir, "officers"), { recursive: true });
    const detail = JSON.stringify({
      disciplinaryActions: [
        {
          contactId: "person",
          caseNumber: "case",
          documentName: "Order",
          documentURL: LEGACY_URL,
        },
      ],
    });
    const detailPath = path.join(sourceDir, "officers", "person.detail.json");
    await writeFile(detailPath, detail);
    const { collectDocuments } =
      await import("../../../../sources/mn-post/acquire/collect-documents.js");
    const f = fetcher();
    await collectDocuments({
      sourceDir,
      statePath: path.join(root, "state"),
      fetchDocument: f.download,
      extractText: async () => ({
        pages: [{ page: 1, method: "text", text: "Order" }],
      }),
      analyzer: {
        model: "test",
        promptVersion: 2,
        analyze: async () => ({
          analysis: {
            allegation: null,
            violation: null,
            finding: null,
            chief_action: null,
            sanction: null,
          },
          absenceReasons: {
            allegation: "The fixture text contains no stated basis.",
            violation: "The fixture text cites no violation.",
            finding: "The fixture text states no finding.",
            chief_action: "The fixture text describes no employer action.",
            sanction: "The fixture text states no sanction.",
          },
        }),
      },
      now: () => "2026-10-18",
    });
    const documentPath = (
      await readdir(path.join(sourceDir, "documents"))
    ).find((name) => name.endsWith(".document.json"))!;
    expect(
      JSON.parse(
        await readFile(path.join(sourceDir, "documents", documentPath), "utf8"),
      ).url,
    ).toBe(LEGACY_URL);
    expect(await readFile(detailPath, "utf8")).toBe(detail);
    expect(f.get.mock.calls.map((call) => call[0])).toEqual([CURRENT_URL]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  CURRENT_URL,
  LEGACY_URL.replace("mnitservices--c", "another-org--c"),
  LEGACY_URL.replace("/sfc/dist/", "/other/"),
])("leaves other transport targets unchanged: %s", async (url) => {
  const f = fetcher();
  await f.download(url);
  expect(f.get.mock.calls.map((call) => call[0])).toEqual([url]);
});
