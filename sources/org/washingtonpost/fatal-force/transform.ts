import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { InputAccounting } from "../../../../src/cli/transform/accounting.js";
import type {
  EmittedRecords,
  SourceTransform,
} from "../../../../src/cli/transform/source-transform.js";
import {
  FatalShootingSpec,
  FatalShootingAgencySpec,
} from "../../../../src/shared/io/index.js";
import { DATASET, FILES, readEvidence } from "./evidence.js";
const INCIDENT_COLUMNS =
  "id,date,threat_type,flee_status,armed_with,city,county,state,latitude,longitude,location_precision,name,age,gender,race,race_source,was_mental_illness_related,body_camera,agency_ids".split(
    ",",
  );
const AGENCY_COLUMNS = "id,name,type,state,oricodes,total_shootings".split(",");
function rows(bytes: string, columns: string[]): Record<string, string>[] {
  const records = parse(bytes, {
    bom: true,
    skip_empty_lines: true,
    columns: (actual: string[]) => {
      if (actual.join(",") !== columns.join(","))
        throw new Error("Unexpected Fatal Force CSV columns");
      return actual;
    },
  }) as Record<string, string>[];
  const seen = new Set<string>();
  for (const row of records) {
    if (!/^\d+$/.test(row.id!) || seen.has(row.id!))
      throw new Error("Missing, invalid or duplicate Fatal Force source id");
    seen.add(row.id!);
  }
  return records;
}
const nullable = (value: string) => (value === "" ? null : value);
function number(value: string) {
  if (value === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new Error("Invalid Fatal Force number");
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error("Invalid Fatal Force number");
  return result;
}
function boolean(value: string) {
  if (value === "") return null;
  if (value !== "True" && value !== "False")
    throw new Error("Invalid Fatal Force boolean");
  return value === "True";
}
function date(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error("Invalid Fatal Force date");
  return value;
}
export const transform: SourceTransform = async ({ paths, logger }) => {
  const files = FILES.map((file) => {
    const matches = paths.filter((p) => path.basename(p) === file);
    if (matches.length !== 1) throw new Error(`Expected exactly one ${file}`);
    return matches[0]!;
  });
  const directory = path.dirname(files[0]!);
  if (path.dirname(files[1]!) !== directory)
    throw new Error("Fatal Force inputs must share an acquisition directory");
  const evidence = await readEvidence(directory);
  const incidentRows = rows(
    await readFile(files[0]!, "utf8"),
    INCIDENT_COLUMNS,
  );
  const agencyRows = rows(await readFile(files[1]!, "utf8"), AGENCY_COLUMNS);
  const provenance = (file: (typeof FILES)[number], id: string) => ({
    source_dataset: DATASET,
    source_record_id: id,
    source_url: evidence[file].sourceUrl,
    source_commit: evidence[file].commit,
    source_sha256: evidence[file].sha256,
    retrieved_at: evidence[file].retrievedAt,
    license: "CC BY-NC-SA 4.0",
    redistribution_class: "noncommercial_sharealike",
    evidence_status: "source_reported",
  });
  const agencies: EmittedRecords = {};
  for (const row of agencyRows) {
    const count = number(row.total_shootings!);
    if (count === null || !Number.isInteger(count) || count < 0)
      throw new Error("Invalid agency shooting count");
    agencies[row.id!] = {
      spec: FatalShootingAgencySpec.parse({
        ...provenance(FILES[1], row.id!),
        agency_id: null,
        name: row.name,
        type: nullable(row.type!),
        state: nullable(row.state!),
        oricodes: nullable(row.oricodes!),
        total_shootings: count,
      }),
    };
  }
  const incidents: EmittedRecords = {};
  const linkedCounts = new Map<string, number>();
  for (const row of incidentRows) {
    const ids = row.agency_ids === "" ? [] : row.agency_ids!.split(";");
    if (ids.some((id) => !Object.hasOwn(agencies, id)))
      throw new Error(`Unknown reported agency for incident ${row.id}`);
    for (const id of new Set(ids))
      linkedCounts.set(id, (linkedCounts.get(id) ?? 0) + 1);
    const spec: Record<string, unknown> = {
      ...provenance(FILES[0], row.id!),
      date: date(row.date!),
      reported_agency_ids: nullable(row.agency_ids!),
    };
    for (const field of [
      "threat_type",
      "flee_status",
      "armed_with",
      "city",
      "county",
      "state",
      "location_precision",
      "name",
      "gender",
      "race",
      "race_source",
    ])
      spec[field] = nullable(row[field]!);
    for (const field of ["age", "latitude", "longitude"])
      spec[field] = number(row[field]!);
    for (const field of ["body_camera", "was_mental_illness_related"])
      spec[field] = boolean(row[field]!);
    incidents[row.id!] = { spec: FatalShootingSpec.parse(spec) };
  }
  for (const row of agencyRows) {
    const linked = linkedCounts.get(row.id!) ?? 0;
    if (Number(row.total_shootings) !== linked) {
      logger?.info(
        `Fatal Force agency ${row.id}: reported total_shootings=${row.total_shootings}, incident links=${linked}; preserving source values.`,
      );
    }
  }
  const accounting: InputAccounting[] = [
    {
      input: FILES[0],
      read: incidentRows.length,
      emitted: Object.keys(incidents).length,
      reported: 0,
      notSelected: {},
    },
    {
      input: FILES[1],
      read: agencyRows.length,
      emitted: Object.keys(agencies).length,
      reported: 0,
      notSelected: {},
    },
  ];
  return {
    artifacts: [
      { kind: "FatalShootings", records: incidents },
      { kind: "FatalShootingAgencies", records: agencies },
    ],
    accounting,
  };
};
