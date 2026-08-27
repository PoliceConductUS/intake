import { describe, it, expect } from "vitest";
import {
  correctSpec,
  applyCorrections,
} from "../../../src/cli/import/artifacts/data-corrections.js";
import type { ArtifactsEnvelope } from "../../../src/shared/io/index.js";

describe("correctSpec", () => {
  it("fixes a matching record, scoped by every 'when' field", () => {
    expect(correctSpec("Agencies", { city: "Meridan", state: "TX" })).toEqual({
      city: "Meridian",
      state: "TX",
    });
    // Belleville is a typo only in TX; elsewhere it is left alone.
    expect(
      correctSpec("Agencies", { city: "Belleville", state: "IL" }),
    ).toEqual({ city: "Belleville", state: "IL" });
  });

  it("matches case-insensitively and leaves other kinds untouched", () => {
    expect(correctSpec("Agencies", { city: "LAPRYOR", state: "tx" })).toEqual({
      city: "La Pryor",
      state: "tx",
    });
    expect(correctSpec("Personnel", { city: "Meridan", state: "TX" })).toEqual({
      city: "Meridan",
      state: "TX",
    });
  });
});

describe("applyCorrections", () => {
  it("corrects matching records in an Artifacts envelope in place", () => {
    const artifacts = {
      spec: {
        artifacts: [
          {
            kind: "Agencies",
            spec: {
              records: {
                a: { spec: { city: "Meridan", state: "TX" } },
                b: { spec: { city: "Dallas", state: "TX" } },
              },
            },
          },
        ],
      },
    } as unknown as ArtifactsEnvelope;

    applyCorrections(artifacts);

    const records = artifacts.spec.artifacts[0].spec.records as Record<
      string,
      { spec: { city: string } }
    >;
    expect(records.a.spec.city).toBe("Meridian");
    expect(records.b.spec.city).toBe("Dallas");
  });
});
