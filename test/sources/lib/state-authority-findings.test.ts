import { describe, expect, it } from "vitest";
import { stateAuthorityRecords } from "../../../sources/lib/state-authority-findings.js";
import type { Finding } from "../../../src/shared/data-annotations.js";

const finding: Finding = {
  code: "case-not-buildable",
  type: "warning",
  field: "civil_cases",
  value: null,
  message: "Case 7 is not listed here because it has no title.",
  source_namespace: "net/example",
  source_record_id: "7",
};

describe("stateAuthorityRecords", () => {
  it("emits one partial update per state processed, with an empty list for a state that has no finding", () => {
    expect(
      stateAuthorityRecords(["TX", "mn"], new Map([["TX", [finding]]])),
    ).toEqual({
      tx: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/tx/" } },
          defects: [finding],
        },
        spec: {},
      },
      mn: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/mn/" } },
          defects: [],
        },
        spec: {},
      },
    });
  });

  it("emits one record for a state named twice in different letter case", () => {
    expect(
      Object.keys(stateAuthorityRecords(["TX", "tx", "Tx"], new Map())),
    ).toEqual(["tx"]);
  });

  it("emits nothing when no state was processed", () => {
    expect(stateAuthorityRecords([], new Map())).toEqual({});
  });

  it("throws on a state that is not a two-letter code", () => {
    expect(() => stateAuthorityRecords(["Texas"], new Map())).toThrow(
      'State is not a two-letter code: "Texas"',
    );
    expect(() => stateAuthorityRecords([""], new Map())).toThrow(
      'State is not a two-letter code: ""',
    );
  });

  it("throws on findings for a state that was not processed", () => {
    expect(() =>
      stateAuthorityRecords(["TX"], new Map([["MN", [finding]]])),
    ).toThrow("Findings for a state that was not processed: mn");
  });
});
