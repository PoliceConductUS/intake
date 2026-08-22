import type { DatabaseClient } from "../database/index.js";
import type {
  AcquireAgencyPage,
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
    async agencies({ states, cursor, limit }): Promise<AcquireAgencyPage> {
      const pageSize = Math.max(1, limit ?? DEFAULT_LIMIT);
      const params: unknown[] = [
        states !== undefined && states.length > 0 ? states : null,
      ];
      let having = "";
      if (cursor !== undefined && cursor !== "") {
        const { officerCount, id } = decodeCursor(cursor);
        params.push(officerCount, id);
        having = "having (count(ao.id), a.id) < ($2::int, $3::text)";
      }
      params.push(pageSize + 1);
      const limitParam = `$${params.length}`;

      const rows = resultRows(
        await client.query(
          `select a.id as id, row_to_json(a.*) as agency, a.state as state,
                  lp.administrative_area_slug as county, lp.place_slug as place,
                  count(ao.id)::int as officer_count
           from agency a
           left join location_path lp on lp.location_path_id = a.location_path_id
           left join agency_officers ao on ao.agency_id = a.id
           where ($1::text[] is null or a.state = any($1))
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
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(Number(last.officer_count), String(last.id))
            : undefined,
      };
    },
  };
}
