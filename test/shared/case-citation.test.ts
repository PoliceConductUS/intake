import { describe, expect, it } from "vitest";
import {
  caseCitation,
  caseCitationSlug,
} from "../../src/shared/case-citation.js";

const docket = {
  title: "Example v. City of Example",
  cause_number: "3:25-cv-03329",
  court: "txnd",
  filed_date: "2025-11-03",
};
describe("case citation slugs", () => {
  it("labels the filing date instead of inventing a decision date", () => {
    expect(caseCitation(docket)).toBe(
      "Example v. City of Example, No. 3:25-cv-03329 (N.D. Tex. filed Nov. 3, 2025)",
    );
    expect(caseCitationSlug(docket)).toBe(
      "example-v-city-of-example-no-3-25-cv-03329-n-d-tex-filed-nov-3-2025",
    );
  });
  it("uses a sourced full citation instead of the docket reference", () => {
    expect(
      caseCitation({
        ...docket,
        full_citation: "Example v. City, 123 F.3d 456 (5th Cir. 1999)",
        citation_source_url: "https://example.org/opinion",
      }),
    ).toBe("Example v. City, 123 F.3d 456 (5th Cir. 1999)");
  });
  it("refuses an unsourced full citation", () => {
    expect(() =>
      caseCitation({ ...docket, full_citation: "123 F.3d 456" }),
    ).toThrow(/source/i);
  });
  it.each(["", "unknown-court"])("refuses unknown court %s", (court) => {
    expect(() => caseCitation({ ...docket, court })).toThrow(/court/i);
  });
  it.each(["2025-02-30", "25-11-03", ""])(
    "refuses invalid filing date %s",
    (filed_date) => {
      expect(() => caseCitation({ ...docket, filed_date })).toThrow(/date/i);
    },
  );
  it("preserves the exact docket suffix", () => {
    expect(
      caseCitation({ ...docket, cause_number: "3:25-cv-03329-S-BN" }),
    ).toContain("No. 3:25-cv-03329-S-BN");
  });
});
