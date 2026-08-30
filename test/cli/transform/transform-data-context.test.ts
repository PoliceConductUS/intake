import { describe, it, expect } from "vitest";
import { createTransformDataContext } from "../../../src/cli/transform/personnel-resolver.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";
import type { SourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

// A fake agency table keyed by the NORMALIZED name the resolver queries with
// (lowercase, non-alphanumeric runs collapsed to a single space). Independent of
// the resolver: the test states the normalized key itself, so a normalization bug
// changes the query param and misses these rows.
function clientReturning(
  rowsByNormalizedName: Record<string, Array<{ id: string }>>,
): { client: DatabaseClient; params: unknown[][] } {
  const params: unknown[][] = [];
  const client = {
    query: async (_sql: string, values: unknown[]) => {
      params.push(values);
      return { rows: rowsByNormalizedName[String(values[0])] ?? [] };
    },
  } as unknown as DatabaseClient;
  return { client, params };
}

function fakeLedger(): SourceNameToCanonicalIdLedger {
  return {
    sourceIdFor: async (
      _namespace: string,
      _kind: string,
      canonicalId: string,
    ) => `src:${canonicalId}`,
    read: async () => undefined,
  } as unknown as SourceNameToCanonicalIdLedger;
}

describe("createTransformDataContext.resolveAgency", () => {
  it("resolves a unique match to a minted source id, normalizing the name", async () => {
    const { client, params } = clientReturning({
      "palestine police department": [{ id: "agency-7" }],
    });
    const data = createTransformDataContext(client, fakeLedger(), "org.subs");

    const result = await data.resolveAgency!({
      agencyName: "  Palestine  Police Dept. ",
    });

    // Punctuation/casing collapse to the normalized key regardless of input form.
    // (Different surface form, same normalized query param.)
    expect(params[0][0]).toBe("palestine police dept");
    expect(result).toBeNull();

    const exact = await data.resolveAgency!({
      agencyName: "Palestine Police Department",
    });
    expect(exact).toEqual({ agencyId: "src:agency-7" });
  });

  it("returns null when the name matches no agency or more than one", async () => {
    const { client } = clientReturning({
      "duplicate pd": [{ id: "a" }, { id: "b" }],
    });
    const data = createTransformDataContext(client, fakeLedger(), "org.subs");

    expect(await data.resolveAgency!({ agencyName: "Nowhere PD" })).toBeNull();
    expect(
      await data.resolveAgency!({ agencyName: "Duplicate PD" }),
    ).toBeNull();
    // Too short to match anything.
    expect(await data.resolveAgency!({ agencyName: "PD" })).toBeNull();
  });
});
