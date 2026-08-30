import { describe, it, expect } from "vitest";
import { facadeComposedIdResolver } from "../../../src/cli/import/artifacts/resolver-kit.js";

// A fake facade whose `value(property)` returns pre-resolved canonical values —
// the composed-id resolver joins them (ADR 0028), so two sources that resolve to
// the same case + agency-personnel converge on one CivilCasePersonnel id.
function fakeFacade(resolved: Record<string, unknown>) {
  return {
    facade: {
      value: async (property: string) => resolved[property],
      raw: () => undefined,
    },
    source: { namespace: "courtlistener", name: "n" },
    backend: {},
  } as never;
}

describe("facadeComposedIdResolver", () => {
  it("joins resolved property values with a pipe", async () => {
    const resolver = facadeComposedIdResolver([
      "civil_case_id",
      "agency_personnel_id",
    ]);
    const id = await resolver.resolve(
      fakeFacade({
        civil_case_id: "txnd:3:23-cv-001",
        agency_personnel_id: "ap-canonical-1",
      }),
      () => "locate",
    );
    expect(id).toBe("txnd:3:23-cv-001|ap-canonical-1");
  });

  it("is identical for the same case + agency-personnel from two sources", async () => {
    const resolver = facadeComposedIdResolver([
      "civil_case_id",
      "agency_personnel_id",
    ]);
    const resolved = {
      civil_case_id: "txnd:3:23-cv-001",
      agency_personnel_id: "ap-canonical-1",
    };
    const a = await resolver.resolve(fakeFacade(resolved), () => "locate");
    const b = await resolver.resolve(fakeFacade(resolved), () => "locate");
    expect(a).toBe(b);
  });

  it("fails loud when a component resolves to no value", async () => {
    const resolver = facadeComposedIdResolver([
      "civil_case_id",
      "agency_personnel_id",
    ]);
    await expect(
      resolver.resolve(
        fakeFacade({ civil_case_id: "txnd:3:23-cv-001" }),
        () => "locate",
      ),
    ).rejects.toThrow(/Cannot compose id: agency_personnel_id/);
  });
});
