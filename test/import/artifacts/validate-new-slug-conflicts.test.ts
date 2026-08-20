import { describe, expect, test } from "vitest";
import { validatePreparedNewSlugConflicts } from "../../../src/cli/import/artifacts/validate-new-slug-conflicts.js";
import type { AgencyRow, ImportRows } from "../../../src/cli/import/artifacts/transform.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";

function newAgency(id: string, slug: string): AgencyRow {
  return {
    id,
    name: "State Patrol",
    city: null,
    state: "MN",
    address: null,
    zip_code: null,
    contact_name: null,
    contact_email: null,
    slug,
    location_path_id: undefined,
    latitude: undefined,
    longitude: undefined,
  };
}

function importRowsWithAgencies(agencies: AgencyRow[]): ImportRows {
  return {
    locationPaths: [],
    locationPathAliases: [],
    agencies,
    agencyOfficers: [],
    preparationMutations: [],
    ownedColumns: { agencies: {}, agencyOfficers: {} },
  };
}

// Every prepared agency is treated as new (no row exists by id); the slug lookup
// returns whichever conflicting rows the client is configured with.
class SlugLookupClient implements DatabaseClient {
  constructor(private readonly existingIdBySlug: Record<string, string> = {}) {}

  async connect(): Promise<unknown> {
    return undefined;
  }

  async end(): Promise<void> {}

  async query(
    text = "",
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    if (/select \* from public\.agency where id = \$1/i.test(text)) {
      return { rows: [] };
    }
    if (/select id, slug from public\.agency where slug = any/i.test(text)) {
      const slugs = (values[0] as string[] | undefined) ?? [];
      return {
        rows: slugs
          .filter((slug) => this.existingIdBySlug[slug] !== undefined)
          .map((slug) => ({ id: this.existingIdBySlug[slug], slug })),
      };
    }
    return { rows: [] };
  }
}

describe("validatePreparedNewSlugConflicts", () => {
  test("rejects a new agency whose slug already belongs to a different database row", async () => {
    const client = new SlugLookupClient({
      "state-patrol": "existing-agency-id",
    });
    const rows = importRowsWithAgencies([
      newAgency("new-agency-id", "state-patrol"),
    ]);

    await expect(
      validatePreparedNewSlugConflicts(client, rows),
    ).resolves.toContain(
      "Cannot insert public.agency new-agency-id; slug state-patrol already belongs to public.agency existing-agency-id.",
    );
  });

  test("rejects two new agencies that share a slug in the same import", async () => {
    const client = new SlugLookupClient();
    const rows = importRowsWithAgencies([
      newAgency("agency-a", "state-patrol"),
      newAgency("agency-b", "state-patrol"),
    ]);

    await expect(
      validatePreparedNewSlugConflicts(client, rows),
    ).resolves.toContain(
      "Cannot prepare import; slug state-patrol appears on multiple new public.agency rows agency-a, agency-b.",
    );
  });

  test("accepts a new agency whose slug is free", async () => {
    const client = new SlugLookupClient();
    const rows = importRowsWithAgencies([
      newAgency("new-agency-id", "state-patrol"),
    ]);

    await expect(
      validatePreparedNewSlugConflicts(client, rows),
    ).resolves.toEqual([]);
  });
});
