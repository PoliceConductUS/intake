import { describe, it, expect } from "vitest";
import { produces, run } from "../../sources/gov.azpost.roster/run.js";

// Disabled for now: the roster only yields agency-less Personnel, so this source
// is a no-op until it emits Agency + AgencyPersonnel (see run.ts).
describe("gov.azpost.roster run (disabled)", () => {
  it("produces nothing and emits no artifacts", async () => {
    expect(produces).toEqual([]);
    const manifest = await run({
      paths: ["a.xlsx"],
      readXlsx: async () => [],
      state: "/state",
      emit: async () => {},
    });
    expect(manifest.artifacts).toEqual([]);
  });
});
