import type { DatabaseClient } from "./index.js";

export type LocationReportWrite = {
  id: string;
  reportType: string;
  reportKey: string;
  title: string;
  summary: string;
  payloadJson: string;
  sortOrder: number;
  status: string;
  publishedAt: string;
};

export type LocationReportSourceWrite = {
  id: string;
  sourceKey: string;
  label: string;
  url: string;
  sourceType: string;
  sortOrder: number;
};

function firstRow<T>(result: unknown): T | undefined {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? ((result as { rows: unknown[] }).rows[0] as T | undefined)
    : undefined;
}

export async function readStateLocationPathId(
  client: DatabaseClient,
  stateSlug: string,
): Promise<string | undefined> {
  const row = firstRow<{ location_path_id?: string }>(
    await client.query(
      `select location_path_id from public.location_path
       where state_or_territory_slug = $1 and level = 'state'`,
      [stateSlug],
    ),
  );
  return row?.location_path_id;
}

export async function replaceLocationReport(
  client: DatabaseClient,
  locationPathId: string,
  report: LocationReportWrite,
  sources: LocationReportSourceWrite[],
): Promise<void> {
  await client.query("begin");
  try {
    await client.query(
      `delete from public.location_report_sources
       where location_report_id in (
         select id from public.location_reports
         where location_path_id = $1 and report_key = $2
       )`,
      [locationPathId, report.reportKey],
    );
    await client.query(
      `delete from public.location_reports
       where location_path_id = $1 and report_key = $2`,
      [locationPathId, report.reportKey],
    );
    await client.query(
      `insert into public.location_reports (
         id, location_path_id, report_type, report_key, title, summary,
         payload, sort_order, status, published_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, now(), now())`,
      [
        report.id,
        locationPathId,
        report.reportType,
        report.reportKey,
        report.title,
        report.summary,
        report.payloadJson,
        report.sortOrder,
        report.status,
        report.publishedAt,
      ],
    );
    for (const source of sources) {
      await client.query(
        `insert into public.location_report_sources (
           id, location_report_id, source_key, label, url, source_type,
           sort_order, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
        [
          source.id,
          report.id,
          source.sourceKey,
          source.label,
          source.url,
          source.sourceType,
          source.sortOrder,
        ],
      );
    }
    await client.query("commit");
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  }
}
