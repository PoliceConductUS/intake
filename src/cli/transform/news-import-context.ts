import { rowsFromResult, type DatabaseClient } from "../database/index.js";
import type { SourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";
import type {
  NewsImportContext,
  SourceRef,
  ReleaseArticle,
  NewsOccurrence,
} from "../../shared/release-news.js";
export function newsImportContext(
  client: DatabaseClient,
  ledger: SourceNameToCanonicalIdLedger,
  namespace: string,
): NewsImportContext {
  return {
    async bindArticleSources(groups) {
      // Preflight every group before recording any new source mapping.
      const plans: Array<{ sources: SourceRef[]; id?: string }> = [];
      for (const { sources, canonicalIds, normalizedUrls } of groups) {
        const ids = new Set(canonicalIds);
        for (const { namespace, sourceId } of sources) {
          const mapped = await ledger.read(namespace, "CoverageLink", sourceId);
          if (mapped) ids.add(mapped);
          const rows = rowsFromResult(
            await client.query(
              "select id from coverage_links where source_namespace=$1 and source_id=$2",
              [namespace, sourceId],
            ),
          );
          for (const row of rows) ids.add(String(row.id));
        }
        const byUrl = rowsFromResult(
          await client.query(
            "select id from coverage_links where normalized_url = any($1::text[])",
            [normalizedUrls],
          ),
        );
        for (const row of byUrl) ids.add(String(row.id));
        if (ids.size > 1)
          throw Error(
            "Conflicting CoverageLink IDs for " +
              JSON.stringify(sources) +
              ": " +
              [...ids].join(", "),
          );
        plans.push({ sources, id: [...ids][0] });
      }
      const results: string[] = [];
      for (const plan of plans) {
        let id = plan.id;
        for (const ref of plan.sources) {
          const expected = id;
          const mapped = await ledger.findOrCreate(
            ref.namespace,
            "CoverageLink",
            ref.sourceId,
            expected ? async () => expected : undefined,
          );
          if (expected && expected !== mapped)
            throw Error(
              "Conflicting CoverageLink source mapping: " + ref.sourceId,
            );
          id = mapped;
        }
        results.push(id!);
      }
      return results;
    },
    async assignmentRef(id) {
      const rows = rowsFromResult(
        await client.query("select id from agency_personnel where id=$1", [id]),
      );
      if (rows.length !== 1)
        throw Error("Release assignment does not exist: " + id);
      return ledger.sourceIdFor(namespace, "AgencyPersonnel", id);
    },
    async existingArticle(ref) {
      const mapped =
        ref.namespace && ref.sourceId
          ? await ledger.read(ref.namespace, "CoverageLink", ref.sourceId)
          : undefined;
      const rows = rowsFromResult(
        await client.query(
          "select * from coverage_links where id=$1 or (source_namespace=$2 and source_id=$3)",
          [ref.canonicalId ?? mapped, ref.namespace, ref.sourceId],
        ),
      );
      if (ref.canonicalId && mapped && ref.canonicalId !== mapped)
        throw Error("Coverage source and canonical ID disagree.");
      if (!rows.length) return undefined;
      if (rows.length !== 1)
        throw Error("Coverage source and canonical ID disagree.");
      const row = rows[0]!;
      if (
        (ref.canonicalId && row.id !== ref.canonicalId) ||
        (mapped && row.id !== mapped)
      )
        throw Error("Coverage source and canonical ID disagree.");
      const url = String(row.url);
      const occurrences = row.occurrences as Record<
        string,
        NewsOccurrence
      > | null;
      const assigned = rowsFromResult(
        await client.query(
          "select * from coverage_link_agency_personnel where coverage_link_id=$1",
          [row.id],
        ),
      );
      return {
        canonicalId: String(row.id),
        ...(row.source_namespace
          ? {
              namespace: String(row.source_namespace),
              sourceId: String(row.source_id),
            }
          : {}),
        preferredUrl: url,
        normalizedUrl: String(row.normalized_url),
        notes: row.notes as string | null,
        occurrences: occurrences ?? {
          [url]: {
            url,
            title: String(row.title),
            sourceName: row.source_name as string | null,
            publishedAt: row.published_at as string | null,
            summary: row.summary as string | null,
          },
        },
        relationships: assigned.map((r) => ({
          canonicalId: String(r.id),
          ...(r.source_namespace
            ? {
                namespace: String(r.source_namespace),
                sourceId: String(r.source_id),
              }
            : {}),
          agencyPersonnelId: String(r.agency_personnel_id),
          confidence: String(r.confidence),
          notes: r.notes as string | null,
          occurrenceUrl: r.occurrence_url as string | null,
          ...(r.correction_reason ? { needsCorrection: true } : {}),
        })),
      } satisfies ReleaseArticle;
    },
  };
}
