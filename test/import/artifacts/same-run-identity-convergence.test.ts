import { describe, it, expect } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { CivilCaseUpdate } from "../../../src/cli/import/artifacts/io/generated-mutations/CivilCaseUpdate.js";

// A DB with only the /tx/ location_path (no rows), so CivilCase's state resolver
// resolves but nothing pre-exists — the convergence is purely same-run.
class TxLocationClient extends EmptyDatabaseClient {
  async query(
    text = "",
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    if (/from public\.location_path\b/.test(text) && values[0] === "/tx/") {
      return {
        rows: [
          {
            location_path_id: "tx-location-path-id",
            path: "/tx/",
            level: "state",
            display_name: "Texas",
            parent_location_path_id: null,
            centroid: null,
            bbox: null,
          },
        ],
      };
    }
    return { rows: [] };
  }
}

// Two records that resolve to the SAME natural identity within one run must
// converge: the first is a create, the rest reuse the first's just-created state
// as their `current` so they diff (upsert "update") or no-op (upsert "read")
// against it — never a second create. Last-wins falls out of the diff; the
// natural-key columns are never touched.
describe("same-run identity convergence (natural-key kinds)", () => {
  function context(): DataContext {
    return new DataContext({
      client: new EmptyDatabaseClient(),
      commandName: "cmd",
      ledger: fakeSourceNameLedger({}),
    });
  }

  it("LocationPathAlias (upsert:read): first creates, second reads — not two creates", async () => {
    const data = context();
    // Same-run LocationPath so the alias FK resolves.
    data.facadeFromSource("LocationPath", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "census",
      name: "/y/",
      spec: {
        location_path_id: "/y/",
        path: "/y/",
        level: "state",
        display_name: "Y",
        parent_location_path_id: null,
      },
    });
    data.facadeFromSource("LocationPathAlias", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "census",
      name: "record-A",
      spec: { alias_path: "/x/", location_path_id: "/y/" },
    });
    data.facadeFromSource("LocationPathAlias", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "census",
      name: "record-B",
      spec: { alias_path: "/x/", location_path_id: "/y/" },
    });

    const kinds = (await data.toMutations())
      .filter((m) => String(m.kind).startsWith("LocationPathAlias"))
      .map((m) => m.kind);

    expect(kinds).toEqual(["LocationPathAliasCreate", "LocationPathAliasRead"]);
  });

  it("CivilCase (upsert:update): first creates, second updates last-wins — through the same lookup as a cross-run row", async () => {
    const data = new DataContext({
      client: new TxLocationClient(),
      commandName: "cmd",
      ledger: fakeSourceNameLedger({}),
    });
    const base = {
      id: "txnd:3:23-cv-001",
      title: "Doe v. City",
      cause_number: "3:23-cv-001",
      court: "txnd",
      filed_date: "2023-04-01",
      claims_summary: "First summary.",
      slug: "doe-v-city",
      outcome: null,
      primary_source_url: null,
      date_terminated: null,
      location_path_id: "tx",
    };
    // Same natural id, different source record-keys, same run.
    data
      .facadeFromSource("CivilCase", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "clearinghouse-api",
        name: "record-A",
      })
      .merge(base);
    data
      .facadeFromSource("CivilCase", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "courtlistener",
        name: "record-B",
      })
      .merge({ ...base, claims_summary: "Second summary." });

    const muts = await data.toMutations();
    expect(muts.map((m) => m.kind)).toEqual([
      "CivilCaseCreate",
      "CivilCaseUpdate",
    ]);
    // Last-wins: the update diffs the second's summary against the first's created
    // state, and never touches the natural-key column `id`.
    const { operations } = CivilCaseUpdate.schema.parse(muts[1]).spec;
    const summarySet = operations.find(
      (op) => op.action === "set" && op.path === "claims_summary",
    );
    expect(summarySet?.action === "set" ? summarySet.to : undefined).toBe(
      "Second summary.",
    );
    expect(operations.some((op) => op.path === "id")).toBe(false);
  });
});
