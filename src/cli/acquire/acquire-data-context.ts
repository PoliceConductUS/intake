import { rowsFromResult, type DatabaseClient } from "../database/index.js";
import type {
  AcquireAgencyPage,
  AcquireDataContext,
  AcquireSearchResult,
} from "../transform/source-transform.js";
import type { SourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";

const DEFAULT_LIMIT = 100;
const SEARCH_LIMIT = 20;

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
 * from location_path, keyset-paginated on (officer_count desc, id desc). Each
 * agency's canonical id is exchanged for the calling namespace's own source id
 * (ADR 0023) so the acquire never sees a canonical id or foreign key.
 */
export function createAcquireDataContext(
  client: DatabaseClient,
  ledger: SourceNameToCanonicalIdLedger,
  namespace: string,
): AcquireDataContext {
  return {
    async agencies({
      states,
      minOfficers,
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

      const rows = rowsFromResult(
        await client.query(
          `select a.id as id, a.name as name, a.state as state,
                  parent.display_name as county, lp.display_name as place,
                  count(ao.id)::int as officer_count
           from agency a
           left join location_path lp on lp.location_path_id = a.location_path_id
           left join location_path parent
             on parent.location_path_id = lp.parent_location_path_id
           left join agency_personnel ao on ao.agency_id = a.id
           where ($1::text[] is null or a.state = any($1))
           group by a.id, parent.display_name, lp.display_name
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
        items: await Promise.all(
          page.map(async (row) => ({
            agencyId: await ledger.sourceIdFor(
              namespace,
              "Agency",
              String(row.id),
            ),
            name: String(row.name ?? ""),
            state: String(row.state ?? ""),
            county: (row.county as string | null) ?? null,
            place: (row.place as string | null) ?? null,
          })),
        ),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(Number(last.officer_count), String(last.id))
            : undefined,
      };
    },

    async search(kind, query): Promise<AcquireSearchResult[]> {
      const like = `%${query.trim()}%`;
      // LocationPath is not ledger-mapped: its `path` IS the reference the import
      // resolves by (ADR 0031). Every other kind exchanges its canonical id for a
      // namespace-local source id via the ledger, so no canonical id leaves.
      if (kind === "LocationPath") {
        return rowsFromResult(
          await client.query(
            `select path, display_name, level from location_path
              where display_name ilike $1 or path ilike $1
              order by level, path limit ${SEARCH_LIMIT}`,
            [like],
          ),
        ).map((row) => ({
          sourceId: String(row.path),
          label: `${String(row.display_name)} — ${String(row.path)} [${String(row.level)}]`,
        }));
      }
      if (kind === "Agency") {
        return Promise.all(
          rowsFromResult(
            await client.query(
              `select id, name, state from agency where name ilike $1
                order by name limit ${SEARCH_LIMIT}`,
              [like],
            ),
          ).map(async (row) => ({
            sourceId: await ledger.sourceIdFor(
              namespace,
              "Agency",
              String(row.id),
            ),
            label: `${String(row.name)}, ${String(row.state)}`,
          })),
        );
      }
      if (kind === "AgencyPersonnel") {
        return Promise.all(
          rowsFromResult(
            await client.query(
              `select ap.id as id, p.first_name as first_name, p.last_name as last_name,
                      a.name as agency, a.state as state, ap.badge_number as badge_number
                 from agency_personnel ap
                 join personnel p on p.id = ap.personnel_id
                 join agency a on a.id = ap.agency_id
                where (p.first_name || ' ' || p.last_name) ilike $1
                   or p.last_name ilike $1
                order by p.last_name, p.first_name limit ${SEARCH_LIMIT}`,
              [like],
            ),
          ).map(async (row) => {
            const badge = String(row.badge_number ?? "").trim();
            return {
              sourceId: await ledger.sourceIdFor(
                namespace,
                "AgencyPersonnel",
                String(row.id),
              ),
              label: `${String(row.first_name)} ${String(row.last_name)} — ${String(row.agency)}, ${String(row.state)}${badge === "" ? "" : ` (#${badge})`}`,
            };
          }),
        );
      }
      if (kind === "CivilCase") {
        // CivilCase is natural-key, not ledger-mapped (ADR 0028): its `id` (court:
        // docket) IS the reference the import resolves by — like LocationPath's path.
        return rowsFromResult(
          await client.query(
            `select id, title, cause_number, court from civil_cases
              where title ilike $1 or cause_number ilike $1
              order by filed_date desc nulls last limit ${SEARCH_LIMIT}`,
            [like],
          ),
        ).map((row) => {
          const court = String(row.court ?? "").trim();
          return {
            sourceId: String(row.id),
            label: `${String(row.title)} — ${String(row.cause_number)}${court === "" ? "" : ` [${court}]`}`,
          };
        });
      }
      throw new Error(
        `AcquireDataContext.search does not support kind ${kind} yet.`,
      );
    },
  };
}
