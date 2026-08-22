import type { DatabaseClient } from "../database/index.js";
import type {
  AcquireAgencyPage,
  AcquireCivilCase,
  AcquireDataContext,
} from "../run/source-run.js";

const DEFAULT_LIMIT = 100;

function resultRows(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Record<string, unknown>[] }).rows
    : [];
}

function encodeCursor(officerCount: number, id: string): string {
  return Buffer.from(`${officerCount}:${id}`, "utf8").toString("base64");
}

function decodeCursor(cursor: string): { officerCount: number; id: string } {
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  return {
    officerCount: Number(decoded.slice(0, separator)),
    id: decoded.slice(separator + 1),
  };
}

/**
 * Agencies ordered by officer count (largest first), with their location context
 * from location_path, keyset-paginated on (officer_count desc, id desc).
 */
export function createAcquireDataContext(
  client: DatabaseClient,
): AcquireDataContext {
  return {
    async agencies({
      states,
      minOfficers,
      hasCivilCase,
      cursor,
      limit,
    }): Promise<AcquireAgencyPage> {
      const pageSize = Math.max(1, limit ?? DEFAULT_LIMIT);
      const params: unknown[] = [
        states !== undefined && states.length > 0 ? states : null,
        minOfficers ?? 0,
      ];
      const havingParts = ["count(ao.id) >= $2"];
      if (cursor !== undefined && cursor !== "") {
        const { officerCount, id } = decodeCursor(cursor);
        params.push(officerCount, id);
        havingParts.push("(count(ao.id), a.id) < ($3::int, $4::text)");
      }
      const having = `having ${havingParts.join(" and ")}`;
      params.push(pageSize + 1);
      const limitParam = `$${params.length}`;

      const attachedCases = `
        from civil_case_officers cco
        join agency_officers cao on cao.id = cco.agency_officer_id
        join civil_cases cc on cc.id = cco.civil_case_id
        where cao.agency_id = a.id`;
      const civilCasesSelect = `, (select coalesce(json_agg(distinct jsonb_build_object(
               'id', cc.id, 'cause_number', cc.cause_number,
               'primary_source_url', cc.primary_source_url)), '[]'::json)
             ${attachedCases}) as civil_cases`;
      const hasCivilCaseFilter = hasCivilCase
        ? `and exists (select 1 ${attachedCases})`
        : "";

      const rows = resultRows(
        await client.query(
          `select a.id as id, row_to_json(a.*) as agency, a.state as state,
                  lp.administrative_area_slug as county, lp.place_slug as place,
                  count(ao.id)::int as officer_count${civilCasesSelect}
           from agency a
           left join location_path lp on lp.location_path_id = a.location_path_id
           left join agency_officers ao on ao.agency_id = a.id
           where ($1::text[] is null or a.state = any($1)) ${hasCivilCaseFilter}
           group by a.id, lp.administrative_area_slug, lp.place_slug
           ${having}
           order by officer_count desc, a.id desc
           limit ${limitParam}`,
          params,
        ),
      );

      const hasMore = rows.length > pageSize;
      const page = rows.slice(0, pageSize);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          state: String(row.state ?? ""),
          county: (row.county as string | null) ?? null,
          place: (row.place as string | null) ?? null,
          agency: (row.agency ?? {}) as Record<string, unknown>,
          civilCases: Array.isArray(row.civil_cases)
            ? (row.civil_cases as AcquireCivilCase[])
            : [],
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(Number(last.officer_count), String(last.id))
            : undefined,
      };
    },
  };
}
