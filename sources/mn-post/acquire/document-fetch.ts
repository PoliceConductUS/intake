import type { CollectLogger } from "./collect.js";
import type { FetchedDocument } from "./collect-documents.js";

const silentLogger: CollectLogger = { info() {} };
const PUBLIC_LINK_RENDER_MS = 30_000;

/**
 * Fetch a disciplinary order from the site's Salesforce file storage. Two link
 * shapes occur: a direct version download (`/sfc/dist/version/download/…`),
 * fetched as-is, and a public content-delivery page (`/sfc/p/…`) that renders
 * the file in the browser — for those the page is opened, the rendered file
 * version is read out of it, and the same direct download URL is derived. A
 * 404, or a page that no longer serves a file, is `unavailable` (reported, not
 * failed); anything that is not a PDF is never written as one.
 */
export function createDocumentFetcher({
  context,
  logger = silentLogger,
}: {
  context: import("playwright").BrowserContext;
  logger?: CollectLogger;
}): (url: string) => Promise<FetchedDocument> {
  async function download(url: string): Promise<FetchedDocument> {
    const response = await context.request.get(url, { maxRedirects: 5 });
    if (response.status() === 404) {
      return { kind: "unavailable", reason: "the site returned 404" };
    }
    if (!response.ok()) {
      throw new Error(
        `mn-post: document download failed with ${response.status()}: ${url}`,
      );
    }
    const bytes = await response.body();
    if (!isPdf(bytes)) {
      return {
        kind: "unavailable",
        reason: `the site returned ${response.headers()["content-type"] ?? "unknown content"} instead of a PDF`,
      };
    }
    return { kind: "pdf", bytes };
  }

  return async (url: string): Promise<FetchedDocument> => {
    if (!isPublicContentLink(url)) return download(url);
    const page = await context.newPage();
    try {
      logger.info(`mn-post: resolving public content link ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const rendered = await page
        .waitForFunction(
          () =>
            /renditionDownload\?[^"']*versionId=/.test(
              document.documentElement.outerHTML,
            ),
          undefined,
          { timeout: PUBLIC_LINK_RENDER_MS },
        )
        .then(() => true)
        .catch(() => false);
      const html = await page.content();
      if (!rendered) {
        return {
          kind: "unavailable",
          reason: isContentDeliveryError(html)
            ? "the content delivery has been deleted or expired"
            : "the public content page did not render a file",
        };
      }
      return download(publicContentDownloadUrl(url, html));
    } finally {
      await page.close();
    }
  };
}

export function isPublicContentLink(url: string): boolean {
  return new URL(url).pathname.startsWith("/sfc/p/");
}

/**
 * The direct download URL for a rendered public content page: the org id and
 * delivery path come from the page URL, the file version id from the rendition
 * links the page loaded.
 */
export function publicContentDownloadUrl(
  pageUrl: string,
  html: string,
): string {
  const parsed = new URL(pageUrl);
  const delivery = parsed.pathname.match(/^\/sfc\/p\/([^/]+)(\/.+)$/);
  const versionId = html.match(/renditionDownload\?[^"']*?versionId=([^&"']+)/);
  if (delivery === null || versionId === null) {
    throw new Error(
      `mn-post: could not derive a download URL for public content link ${pageUrl}`,
    );
  }
  const query = new URLSearchParams({
    oid: `00D${delivery[1]}`,
    ids: versionId[1],
    d: delivery[2],
    asPdf: "false",
  });
  return `${parsed.origin}/sfc/dist/version/download/?${query.toString()}`;
}

function isContentDeliveryError(html: string): boolean {
  return /Unable to Process Request|content delivery/i.test(html);
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}
