import { describe, expect, it } from "vitest";
import {
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
