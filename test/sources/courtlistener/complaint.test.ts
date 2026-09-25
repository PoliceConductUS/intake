import { describe, it, expect } from "vitest";
import {
  extractComplaintIntro,
  fetchComplaintIntro,
  selectOperativeComplaintText,
} from "../../../sources/courtlistener/complaint.js";

describe("extractComplaintIntro", () => {
  it("returns the Nature of the Action section verbatim, up to the next heading", () => {
    const text = [
      "UNITED STATES DISTRICT COURT",
      "JANE DOE, Plaintiff, v. CITY OF EXAMPLE, Defendant.",
      "COMPLAINT",
      "NATURE OF THE ACTION",
      "1. This is a civil rights action under 42 U.S.C. § 1983 arising from the",
      "use of excessive force by Officer Smith during an arrest on May 1, 2023.",
      "JURISDICTION AND VENUE",
      "2. This Court has jurisdiction under 28 U.S.C. § 1331.",
    ].join("\n");
    const intro = extractComplaintIntro(text);
    expect(intro).toContain("42 U.S.C. § 1983");
    expect(intro).toContain("excessive force by Officer Smith");
    // Stops at the next section heading — does not bleed into jurisdiction.
    expect(intro).not.toContain("28 U.S.C. § 1331");
  });

  it("recognizes INTRODUCTION and PRELIMINARY STATEMENT headings", () => {
    expect(
      extractComplaintIntro(
        "INTRODUCTION\nThis action challenges an unconstitutional strip-search policy that harmed the plaintiff and others.\nTHE PARTIES\nPlaintiff is a resident.",
      ),
    ).toContain("unconstitutional strip-search policy");
    expect(
      extractComplaintIntro(
        "PRELIMINARY STATEMENT\nDefendants subjected the plaintiff to unlawful detention over several hours without cause.\nPARTIES\n...",
      ),
    ).toContain("unlawful detention");
  });

  it("returns undefined when there is no intro heading or it is too short", () => {
    expect(
      extractComplaintIntro("COMPLAINT\n1. Plaintiff sues defendant. PARTIES"),
    ).toBeUndefined();
    expect(
      extractComplaintIntro("NATURE OF THE ACTION\nToo short.\nPARTIES"),
    ).toBeUndefined();
  });

  it("caps at the requested length with an ellipsis at a sentence boundary", () => {
    const long = `NATURE OF THE ACTION\n${"This sentence describes the claim in detail. ".repeat(60)}JURISDICTION`;
    const intro = extractComplaintIntro(long, 200);
    expect(intro).toBeDefined();
    expect(intro!.length).toBeLessThanOrEqual(201);
    expect(intro!.endsWith("…")).toBe(true);
  });
});

const AVAILABLE = { is_available: true };

describe("selectOperativeComplaintText", () => {
  it("prefers the latest amended complaint over the original", () => {
    const entries = [
      {
        entry_number: 1,
        description: "COMPLAINT",
        recap_documents: [
          { ...AVAILABLE, plain_text: "original complaint text" },
        ],
      },
      {
        entry_number: 14,
        description: "AMENDED COMPLAINT",
        recap_documents: [
          {
            ...AVAILABLE,
            description: "First Amended Complaint",
            plain_text: "amended complaint text",
          },
        ],
      },
    ];
    expect(selectOperativeComplaintText(entries)).toBe(
      "amended complaint text",
    );
  });

  it("takes the earliest complaint when there is no amended one", () => {
    const entries = [
      {
        entry_number: 9,
        description: "COMPLAINT (duplicate)",
        recap_documents: [{ ...AVAILABLE, plain_text: "later complaint" }],
      },
      {
        entry_number: 1,
        description: "COMPLAINT",
        recap_documents: [{ ...AVAILABLE, plain_text: "first complaint" }],
      },
    ];
    expect(selectOperativeComplaintText(entries)).toBe("first complaint");
  });

  it("ignores filings that merely mention a complaint", () => {
    const entries = [
      {
        entry_number: 3,
        description: "MOTION to Dismiss the Complaint",
        recap_documents: [
          { ...AVAILABLE, plain_text: "a motion, not the complaint" },
        ],
      },
      {
        entry_number: 5,
        description: "ANSWER to Complaint",
        recap_documents: [{ ...AVAILABLE, plain_text: "an answer" }],
      },
    ];
    expect(selectOperativeComplaintText(entries)).toBeUndefined();
  });

  it("skips complaints whose document is unavailable or empty", () => {
    const entries = [
      {
        entry_number: 1,
        description: "COMPLAINT",
        recap_documents: [{ is_available: false, plain_text: "sealed" }],
      },
      {
        entry_number: 2,
        description: "COMPLAINT",
        recap_documents: [{ ...AVAILABLE, plain_text: "   " }],
      },
    ];
    expect(selectOperativeComplaintText(entries)).toBeUndefined();
  });
});

describe("fetchComplaintIntro", () => {
  it("returns the extracted intro of the operative complaint", async () => {
    const fetchJson = async () => ({
      results: [
        {
          entry_number: 1,
          description: "COMPLAINT",
          recap_documents: [
            {
              is_available: true,
              plain_text:
                "NATURE OF THE ACTION\n1. This § 1983 action arises from an unlawful arrest and the use of a taser without justification.\nPARTIES\n...",
            },
          ],
        },
      ],
    });
    const intro = await fetchComplaintIntro("123", fetchJson);
    expect(intro).toContain("unlawful arrest");
  });

  it("returns undefined on any fetch error (best-effort)", async () => {
    const fetchJson = async () => {
      throw new Error("403 entries not accessible");
    };
    expect(await fetchComplaintIntro("123", fetchJson)).toBeUndefined();
  });
});
