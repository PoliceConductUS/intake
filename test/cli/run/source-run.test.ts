import { describe, it, expect } from "vitest";
import { buildArtifactsEnvelope } from "../../../src/cli/run/source-run.js";

describe("buildArtifactsEnvelope", () => {
  it("builds an inline Artifacts envelope keyed by source-local id", () => {
    const envelope = buildArtifactsEnvelope("gov.azpost.roster", "abc123", {
      artifacts: [
        {
          kind: "Personnel",
          records: {
            "1001": {
              spec: { id: "1001", first_name: "Skip", last_name: "Woodward" },
            },
          },
        },
      ],
    });
    expect(envelope.metadata.namespace).toBe("gov.azpost.roster");
    expect(envelope.metadata.name).toBe("gov.azpost.roster-abc123");
    const item = envelope.spec.artifacts[0];
    expect(item).toMatchObject({
      kind: "Personnel",
      spec: {
        records: {
          "1001": { spec: { first_name: "Skip", last_name: "Woodward" } },
        },
      },
    });
  });

  it("rejects a record missing a required field via the envelope schema", () => {
    expect(() =>
      buildArtifactsEnvelope("s", "d", {
        artifacts: [
          {
            kind: "Personnel",
            records: { "1": { spec: { first_name: "Ann" } } },
          },
        ],
      }),
    ).toThrow(); // PersonnelSpec requires last_name
  });
});
