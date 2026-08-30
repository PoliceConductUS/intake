import { describe, it, expect } from "vitest";
import { createAcquireDataContext } from "../../../src/cli/acquire/acquire-data-context.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";
import type { SourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

// Route the query by the table it selects from, returning fixture rows. The test
// states the rows a real DB would return; the assertions are on how search maps
// them (source id + label), independent of the SQL text.
function clientReturning(
  rowsByTable: Record<string, Record<string, unknown>[]>,
): DatabaseClient {
  return {
    query: async (sql: string) => {
      const table = Object.keys(rowsByTable).find((name) =>
        sql.includes(`from ${name}`),
      );
      return { rows: table === undefined ? [] : rowsByTable[table] };
    },
  } as unknown as DatabaseClient;
}

// Minted source ids are prefixed so a ledger-mapped result is distinguishable from
// a natural-key one (which must NOT go through the ledger).
function fakeLedger(): SourceNameToCanonicalIdLedger {
  return {
    sourceIdFor: async (_ns: string, kind: string, canonicalId: string) =>
      `ledger:${kind}:${canonicalId}`,
    read: async () => undefined,
  } as unknown as SourceNameToCanonicalIdLedger;
}

function context() {
  return createAcquireDataContext(
    clientReturning({
      agency_personnel: [
        {
          id: "ap-1",
          first_name: "Dana",
          last_name: "Reyes",
          agency: "Austin Police Department",
          state: "TX",
          badge_number: "4417",
        },
      ],
      civil_cases: [
        {
          id: "txwd:1:20-cv-00042",
          title: "Reyes v. City of Austin",
          cause_number: "1:20-cv-00042",
          court: "txwd",
        },
      ],
    }),
    fakeLedger(),
    "org.policeconduct.manual",
  );
}

describe("createAcquireDataContext.search", () => {
  it("maps AgencyPersonnel through the ledger, labeling name + agency + badge", async () => {
    const [hit] = await context().search!("AgencyPersonnel", "reyes");
    expect(hit.sourceId).toBe("ledger:AgencyPersonnel:ap-1");
    expect(hit.label).toBe("Dana Reyes — Austin Police Department, TX (#4417)");
  });

  it("returns a CivilCase's natural-key id directly, NOT through the ledger", async () => {
    const [hit] = await context().search!("CivilCase", "reyes");
    // Natural-key identity (ADR 0028): the id IS the reference; no ledger prefix.
    expect(hit.sourceId).toBe("txwd:1:20-cv-00042");
    expect(hit.label).toBe("Reyes v. City of Austin — 1:20-cv-00042 [txwd]");
  });

  it("still throws for a kind it does not support", async () => {
    await expect(context().search!("Discipline", "x")).rejects.toThrow(
      /does not support kind Discipline/,
    );
  });
});
