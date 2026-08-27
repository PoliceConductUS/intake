import type { DatabaseClient } from "../database/index.js";
import type { SourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";
import type { RunDataContext } from "./source-run.js";
import {
  normalizeName,
  officerNameConfidence,
} from "../import/artifacts/name-similarity.js";

// Acceptance bars for a civil-case → agency_personnel match (ADR 0023). The
// agency is known exactly (scoped by its source id), so the personnel name is the
// only scored dimension and it is gated on the name confidence.
const NAME_FLOOR = 0.85;
// Two personnel in the agency whose confidences sit within this band — and whom
// the fuller-name variant (lower uncertainty) cannot separate — are an
// unresolvable tie: attach to neither rather than guess wrong.
const AMBIGUITY_BAND = 0.03;

function resultRows(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Record<string, unknown>[] }).rows
    : [];
}

/**
 * The intake-owned resolver injected into a source's run phase (ADR 0023). It
 * resolves a personnel name to a namespace-local source id — matching, gating, and
 * minting happen here, where the canonical id is known; only the source id
 * crosses back to the source.
 */
export function createRunDataContext(
  client: DatabaseClient,
  ledger: SourceNameToCanonicalIdLedger,
  namespace: string,
): RunDataContext {
  const rosterCache = new Map<string, Promise<Record<string, unknown>[]>>();
  const roster = (
    canonicalAgencyId: string,
  ): Promise<Record<string, unknown>[]> => {
    const cached = rosterCache.get(canonicalAgencyId);
    if (cached !== undefined) return cached;
    const loaded = client
      .query(
        `select row_to_json(o.*) as personnel, row_to_json(ao.*) as agency_personnel
         from agency_personnel ao
         join personnel o on o.id = ao.personnel_id
         where ao.agency_id = $1`,
        [canonicalAgencyId],
      )
      .then(resultRows);
    rosterCache.set(canonicalAgencyId, loaded);
    return loaded;
  };

  return {
    async resolvePersonnel({ agencyId, personnelName }) {
      // agencyId is the agency's namespace-local source id; resolve it to the
      // canonical agency the ordinary way. A source id with no agency is a broken
      // reference — fail loud (ADR 0023).
      const canonicalAgencyId = await ledger.read(
        namespace,
        "Agency",
        agencyId,
      );
      if (canonicalAgencyId === undefined) {
        throw new Error(
          `Agency source id ${agencyId} resolves to no canonical agency in ${namespace} (ADR 0023).`,
        );
      }
      const name = personnelName.trim();
      const tokens = normalizeName(name)
        .split(" ")
        .filter((token) => token.length >= 2);
      if (tokens.length === 0) return null;

      // Pre-filter the roster to personnel sharing a name token, then score.
      const candidates = (await roster(canonicalAgencyId)).filter((row) => {
        const personnel = (row.personnel ?? {}) as Record<string, unknown>;
        const haystack = `${normalizeName(String(personnel.first_name ?? ""))} ${normalizeName(String(personnel.last_name ?? ""))}`;
        return tokens.some((token) => haystack.includes(token));
      });
      const scored = candidates
        .map((row) => {
          const personnel = (row.personnel ?? {}) as Record<string, unknown>;
          const { confidence, uncertainty } = officerNameConfidence(
            name,
            personnel,
          );
          return {
            confidence,
            uncertainty,
            agencyPersonnel: (row.agency_personnel ?? {}) as Record<
              string,
              unknown
            >,
          };
        })
        // Rank by confidence, then lowest uncertainty (fullest matching form).
        .sort(
          (left, right) =>
            right.confidence - left.confidence ||
            left.uncertainty - right.uncertainty,
        );

      const best = scored[0];
      const second = scored[1];
      const ambiguous =
        best !== undefined &&
        second !== undefined &&
        second.confidence >= NAME_FLOOR &&
        best.confidence - second.confidence < AMBIGUITY_BAND &&
        best.uncertainty >= second.uncertainty;
      if (best === undefined || ambiguous || best.confidence < NAME_FLOOR) {
        return null;
      }

      // Mint (or reuse) the source id for the matched person-at-agency and hand
      // back only that — the canonical never crosses the boundary.
      const agencyPersonnelId = await ledger.sourceIdFor(
        namespace,
        "AgencyPersonnel",
        String(best.agencyPersonnel.id),
      );
      return { agencyPersonnelId };
    },

    async resolveCivilCase({ docket }) {
      // Match a docket against existing civil cases, normalizing both sides so
      // punctuation/casing never blocks a hit. A unique match resolves to the
      // case's natural key (court:docket, ADR 0028); anything else is null.
      const normalized = docket.replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (normalized.length < 4) return null;
      const rows = resultRows(
        await client.query(
          `select id from civil_cases
            where regexp_replace(upper(cause_number), '[^A-Z0-9]', '', 'g') = $1`,
          [normalized],
        ),
      );
      if (rows.length !== 1) return null;
      return { civilCaseId: String(rows[0].id) };
    },
  };
}
