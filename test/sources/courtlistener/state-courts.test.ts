import { describe, expect, test } from "vitest";
import { STATE_COURTS } from "../../../sources/courtlistener/acquire.js";

// Independent oracle: the 50 states + DC that any U.S. agency can sit in must all
// be searchable (every one carries at least a district and a circuit), and a
// handful of circuit assignments verified against 28 U.S.C. § 41 — not read back
// from STATE_COURTS itself.
const FIFTY_STATES_PLUS_DC = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
];

const CIRCUIT_BY_STATE: Record<string, string> = {
  ME: "ca1", MA: "ca1", NH: "ca1", RI: "ca1", PR: "ca1",
  CT: "ca2", NY: "ca2", VT: "ca2",
  DE: "ca3", NJ: "ca3", PA: "ca3", VI: "ca3",
  MD: "ca4", NC: "ca4", SC: "ca4", VA: "ca4", WV: "ca4",
  LA: "ca5", MS: "ca5", TX: "ca5",
  KY: "ca6", MI: "ca6", OH: "ca6", TN: "ca6",
  IL: "ca7", IN: "ca7", WI: "ca7",
  AR: "ca8", IA: "ca8", MN: "ca8", MO: "ca8", NE: "ca8", ND: "ca8", SD: "ca8",
  AK: "ca9", AZ: "ca9", CA: "ca9", HI: "ca9", ID: "ca9",
  MT: "ca9", NV: "ca9", OR: "ca9", WA: "ca9", GU: "ca9",
  CO: "ca10", KS: "ca10", NM: "ca10", OK: "ca10", UT: "ca10", WY: "ca10",
  AL: "ca11", FL: "ca11", GA: "ca11",
  DC: "cadc",
};

describe("courtlistener STATE_COURTS", () => {
  test("covers all 50 states plus DC", () => {
    for (const state of FIFTY_STATES_PLUS_DC) {
      expect(STATE_COURTS[state], `missing ${state}`).toBeDefined();
      // at least one district court and its circuit
      expect(STATE_COURTS[state].length).toBeGreaterThanOrEqual(2);
    }
  });

  test("places each state in its 28 U.S.C. § 41 circuit", () => {
    for (const [state, circuit] of Object.entries(CIRCUIT_BY_STATE)) {
      expect(STATE_COURTS[state], `missing ${state}`).toContain(circuit);
    }
  });

  test("lists only district (…d) and circuit (ca…/cadc) court ids", () => {
    for (const [state, courts] of Object.entries(STATE_COURTS)) {
      for (const court of courts) {
        expect(
          /^[a-z]{2}[nsewmc]?d$|^ca(\d{1,2}|dc)$/.test(court),
          `${state} → ${court}`,
        ).toBe(true);
      }
    }
  });
});
