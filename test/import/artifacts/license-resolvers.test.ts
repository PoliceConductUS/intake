import { describe, it, expect } from "vitest";
import {
  licenseStatusResolver,
  licenseTypeResolver,
} from "../../../src/cli/import/artifacts/facades/license-resolvers.js";

const locate = () => "license";
function ctx(row: Record<string, unknown>) {
  return {
    facade: { raw: (key: string) => row[key], value: async () => undefined },
    source: { namespace: "gov.tx.tcole", name: "x" },
    backend: undefined,
  } as never;
}

describe("licenseStatusResolver", () => {
  const resolver = licenseStatusResolver();
  it("Title-cases and merges casing dupes", async () => {
    expect(await resolver.resolve(ctx({ status: "ACTIVE" }), locate)).toBe(
      "Active",
    );
    expect(await resolver.resolve(ctx({ status: "Active" }), locate)).toBe(
      "Active",
    );
    expect(await resolver.resolve(ctx({ status: "INACTIVE" }), locate)).toBe(
      "Inactive",
    );
  });
  it("blank/absent → null", async () => {
    expect(await resolver.resolve(ctx({ status: "" }), locate)).toBeNull();
    expect(await resolver.resolve(ctx({}), locate)).toBeNull();
  });
});

describe("licenseTypeResolver", () => {
  const resolver = licenseTypeResolver();
  it("maps bare forms to canonical and collapses whitespace", async () => {
    expect(
      await resolver.resolve(ctx({ license_type: "Peace Officer" }), locate),
    ).toBe("Peace Officer License");
    expect(
      await resolver.resolve(
        ctx({ license_type: "Peace Officer License" }),
        locate,
      ),
    ).toBe("Peace Officer License");
    expect(
      await resolver.resolve(
        ctx({ license_type: "Telecommunications  Operator" }),
        locate,
      ),
    ).toBe("Telecommunications Operator License");
  });
  it("leaves non-dupe types unchanged", async () => {
    expect(
      await resolver.resolve(ctx({ license_type: "Jailer License" }), locate),
    ).toBe("Jailer License");
    expect(
      await resolver.resolve(ctx({ license_type: "Elected Official" }), locate),
    ).toBe("Elected Official");
  });
});
