import { describe, it, expect } from "vitest";
import {
  courtTokenFromName,
  normalizeDocketNumber,
  civilCaseNaturalId,
} from "../../../sources/lib/civil-case-id.js";

describe("courtTokenFromName", () => {
  it("maps a known Clearinghouse court name to the CourtListener court_id", () => {
    expect(courtTokenFromName("Northern District of Texas")).toBe("txnd");
    expect(courtTokenFromName("  District of Minnesota ")).toBe("mnd");
    expect(
      courtTokenFromName("U.S. Court of Appeals for the Fifth Circuit"),
    ).toBe("ca5");
    expect(courtTokenFromName("Supreme Court of the United States")).toBe(
      "scotus",
    );
  });

  it("falls back to a slug for an unmapped court (safe non-match, not a wrong match)", () => {
    // Independent oracle: slugify lowercases and hyphenates non-alphanumerics.
    expect(courtTokenFromName("Minnesota state trial court")).toBe(
      "minnesota-state-trial-court",
    );
  });
});

describe("normalizeDocketNumber", () => {
  it("lowercases and strips whitespace but keeps the PACER structure", () => {
    expect(normalizeDocketNumber("3:16-CV-03089")).toBe("3:16-cv-03089");
    expect(normalizeDocketNumber("  3:16-cv-03089  ")).toBe("3:16-cv-03089");
  });
});

describe("civilCaseNaturalId", () => {
  it("composes court token and normalized docket into a stable id", () => {
    expect(civilCaseNaturalId("txnd", "3:16-cv-03089")).toBe(
      "txnd:3:16-cv-03089",
    );
  });

  it("is identical for the same docket described by two sources", () => {
    // CH: court name -> token; CL: court_id directly. Same docket -> same id.
    const fromClearinghouse = civilCaseNaturalId(
      courtTokenFromName("Northern District of Texas"),
      "3:16-cv-03089",
    );
    const fromCourtListener = civilCaseNaturalId("txnd", "3:16-cv-03089");
    expect(fromClearinghouse).toBe(fromCourtListener);
  });
});
