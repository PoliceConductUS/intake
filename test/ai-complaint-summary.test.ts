import { describe, expect, it } from "vitest";
import { CivilCaseSpec } from "../src/shared/io/index.js";

const summary = {
  summary: "The plaintiff alleges an unlawful detention.",
  source: {
    url: "https://example.org/complaint.pdf",
    sourcePage: "https://example.org/docket/3/",
    documentId: 123,
    documentNumber: "3",
    filingDate: "2025-01-02",
    retrievedAt: "2026-01-02T12:00:00Z",
    sha1: "a".repeat(40),
    sha256: "b".repeat(64),
    sha1Verified: true,
    confidence: "Fidelity to complaint only; allegations unproven",
  },
  model: "test-model",
  generatedAt: "2026-01-02",
  support: [{ paragraph: 1, pages: "1–2" }],
  publicationStatus: "internal draft; not published",
  limitations: "Allegations, not findings.",
  proceduralContext: [
    {
      text: "The docket records a motion.",
      url: "https://example.org/docket/4/",
      sourceDate: "2025-02-01",
      retrievedAt: "2026-01-02T12:00:00Z",
      confidence: "Retrieved docket metadata only",
    },
  ],
};
const record = {
  title: "Synthetic civil case",
  cause_number: "test-1",
  filed_date: "2025-01-02",
  claims_summary: "Legacy material",
};

describe("AI complaint summary intake contract", () => {
  it("accepts distinct sourced summaries without replacing legacy content", () => {
    const parsed = CivilCaseSpec.parse({
      ...record,
      ai_complaint_summary: summary,
    });
    expect(parsed).toMatchObject({
      claims_summary: "Legacy material",
      ai_complaint_summary: summary,
    });
  });
  it("allows cases with no AI summary", () => {
    expect(
      CivilCaseSpec.safeParse({ ...record, ai_complaint_summary: null })
        .success,
    ).toBe(true);
  });
  for (const field of Object.keys(summary.source)) {
    it(`rejects missing source ${field}`, () => {
      const incomplete = structuredClone(summary);
      delete (incomplete.source as Record<string, unknown>)[field];
      expect(
        CivilCaseSpec.safeParse({ ...record, ai_complaint_summary: incomplete })
          .success,
      ).toBe(false);
    });
  }
  it.each(["javascript:alert(1)", "not a URL"])(
    "rejects unsafe source URL %s",
    (url) => {
      expect(
        CivilCaseSpec.safeParse({
          ...record,
          ai_complaint_summary: {
            ...summary,
            source: { ...summary.source, url },
          },
        }).success,
      ).toBe(false);
    },
  );
  it("rejects unverified complaint bytes", () => {
    expect(
      CivilCaseSpec.safeParse({
        ...record,
        ai_complaint_summary: {
          ...summary,
          source: { ...summary.source, sha1Verified: false },
        },
      }).success,
    ).toBe(false);
  });
});

describe("complaint summary unavailability", () => {
  const unavailable = {
    reason: "missing_copy",
    sourceUrl: "https://example.org/docket/",
    checkedAt: "2026-01-02T12:00:00Z",
    detail: "Checked retained complaint inventory; no copy held.",
  };
  it("retains evidenced missing-copy status independently of processing failures", () => {
    for (const reason of [
      "missing_copy",
      "pending",
      "retrieval_failed",
      "authentication_failed",
      "generation_failed",
    ]) {
      expect(
        CivilCaseSpec.safeParse({
          ...record,
          complaint_summary_unavailability: { ...unavailable, reason },
        }).success,
      ).toBe(true);
    }
  });
  it("rejects unavailable claims without internal evidence", () => {
    expect(
      CivilCaseSpec.safeParse({
        ...record,
        complaint_summary_unavailability: { reason: "missing_copy" },
      }).success,
    ).toBe(false);
  });
});
