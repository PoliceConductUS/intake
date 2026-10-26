import { patrolBeatBoundaries } from "./beats.js";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import { readXlsx } from "../../src/cli/transform/read-xlsx.js";
import { normalizeWorkbook } from "./arrest.js";
import { readChildSheets } from "./workbook.js";
import { enrichBookings, type GeographyEvidence } from "./enrichment.js";

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const clean = (value: string) => (value.trim() === "NULL" ? "" : value.trim());
const receiptSchema = z
  .object({
    sourceWorkbookSha256: z.string().regex(/^[a-f0-9]{64}$/),
    incomeSourceWorkbookSha256: z.string().regex(/^[a-f0-9]{64}$/),
    arrestLocationAuditSha256: z.string().regex(/^[a-f0-9]{64}$/),
    arrestLocationCsvSha256: z.string().regex(/^[a-f0-9]{64}$/),
    arrestLocationAuditSourceWorkbookSha256: z.string().regex(/^[a-f0-9]{64}$/),
    arrestLocationAuditSheet: z.literal("Beat Location Audit"),
    arrestLocationAuditHeaderRow: z.literal(4),
    arrestLocationAuditRows: z.number().int().nonnegative(),
    arrestLocationAuditCsvConversion: z.string(),
    addressPointService: z.string().url(),
  })
  .strict();
const tractMapSchema = z.record(
  z.string(),
  z
    .object({
      status: z.string(),
      quality: z.string().optional(),
      geoid: z
        .string()
        .regex(/^\d{11}$/)
        .optional(),
    })
    .strict(),
);

/** Verify the reusable residential matches against raw Census responses and input addresses. */
async function verifyResidentialEvidence(
  geo: string,
  files: string[],
  rows: Record<string, string>[],
  mapping: GeographyEvidence["addressTracts"],
): Promise<void> {
  const addresses = new Map(
    rows.map((row) => {
      const raw = clean(row.Booking_Address!);
      return [digest(raw).slice(0, 24), raw];
    }),
  );
  if (
    addresses.size !== Object.keys(mapping).length ||
    [...addresses.keys()].some((id) => !mapping[id])
  )
    throw new Error(
      "Residential evidence does not cover the original workbook addresses",
    );
  const submitted = new Set<string>();
  for (const filename of files
    .filter((name) => /^geocode-acs2024-\d+-input\.csv$/.test(name))
    .sort()) {
    const inputs = parse(
      await readFile(path.join(geo, filename), "utf8"),
    ) as string[][];
    const outputs = parse(
      await readFile(
        path.join(geo, filename.replace("-input.csv", "-output.csv")),
        "utf8",
      ),
      { relax_column_count: true },
    ) as string[][];
    const responses = new Map(outputs.map((row) => [row[0], row]));
    if (inputs.length !== outputs.length || responses.size !== outputs.length)
      throw new Error("Census geocoder response identity/count mismatch");
    for (const input of inputs) {
      const [id, street, city, state, zip] = input;
      const raw = addresses.get(id!);
      const output = responses.get(id!);
      if (!raw || !output || submitted.has(id!))
        throw new Error("Census geocoder input identity mismatch");
      submitted.add(id!);
      const lastComma = raw.lastIndexOf(",");
      const cityComma = raw.lastIndexOf(",", lastComma - 1);
      const parts =
        cityComma < 0
          ? []
          : [
              raw.slice(0, cityComma),
              raw.slice(cityComma + 1, lastComma),
              raw.slice(lastComma + 1),
            ].map((value) => value.trim());
      const region = /^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(
        parts[2] ?? "",
      );
      if (
        parts.length !== 3 ||
        parts[0] !== street ||
        parts[1] !== city ||
        region?.[1]?.toUpperCase() !== state ||
        (region?.[2] ?? "") !== zip
      )
        throw new Error(
          "Census geocoder input address differs from original workbook",
        );
      const cached = mapping[id!]!;
      if (cached.status === "matched") {
        const responseState = /,\s*([A-Z]{2}),\s*\d{5}\s*$/.exec(
          output[4] ?? "",
        )?.[1];
        if (
          output[2] !== "Match" ||
          output.length !== 12 ||
          cached.geoid !== output.slice(8, 11).join("") ||
          cached.quality !== output[3] ||
          responseState !== state
        )
          throw new Error("Census geocoder tract evidence mismatch");
      } else if (cached.status === "pending")
        throw new Error("Unfinished Census geocoder evidence");
    }
  }
  for (const [id, value] of Object.entries(mapping))
    if (value.status === "matched" && !submitted.has(id))
      throw new Error("Matched Census geocoder tract lacks raw response");
}

/** Acquire an explicit, source-hash-matched evidence bundle; no old truncated-input fallback. */
export const acquire: SourceAcquire = async ({ sourceDir, env, logger }) => {
  const workspace = env.INTAKE_WORKSPACE_TEST ?? env.INTAKE_WORKSPACE;
  if (!workspace?.trim())
    throw new Error("gov.irvingtx.arrests: INTAKE_WORKSPACE is required");
  const input = path.join(workspace, "gov.irvingtx.arrests", "source"),
    geo = path.join(input, "geography");
  const workbook = path.join(input, "arrests.xlsx");
  const workbookBytes = await readFile(workbook);
  const workbookSha = digest(workbookBytes);
  const receipt = receiptSchema.parse(
    JSON.parse(
      await readFile(path.join(geo, "acquisition-receipt.json"), "utf8"),
    ),
  );
  if (receipt.sourceWorkbookSha256 !== workbookSha)
    throw new Error("Original workbook SHA256 mismatch");
  if (receipt.incomeSourceWorkbookSha256 !== workbookSha)
    throw new Error("Income evidence belongs to a different workbook");
  if (receipt.arrestLocationAuditSourceWorkbookSha256 !== workbookSha)
    throw new Error("Arrest location evidence belongs to a different workbook");
  const auditBytes = await readFile(
    path.join(geo, "arrest-location-audit.xlsx"),
  );
  const auditCsv = await readFile(path.join(geo, "arrest-location-audit.csv"));
  if (
    digest(auditBytes) !== receipt.arrestLocationAuditSha256 ||
    digest(auditCsv) !== receipt.arrestLocationCsvSha256
  )
    throw new Error("Arrest location evidence SHA256 mismatch");
  const beatBytes = await readFile(path.join(geo, "beat-polygons.geojson"));
  const beatReceipt = JSON.parse(
    await readFile(path.join(geo, "beat-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  if (beatReceipt.sha256 !== digest(beatBytes))
    throw new Error("Beat polygon evidence SHA256 mismatch");
  const files = (await readdir(geo)).sort();
  const arrests = await readXlsx(workbook, "Arrest Data", [
    "Booking_No",
    "Arrest_Officer_Name",
    "Arrest_Date",
    "Arrest_Time",
    "District",
    "Booking_Address",
    "arrest location",
  ]);
  const { charges, offenses } = await readChildSheets(workbook);
  const addressTracts = tractMapSchema.parse(
    JSON.parse(
      await readFile(path.join(geo, "address-tract-map.json"), "utf8"),
    ),
  );
  await verifyResidentialEvidence(geo, files, arrests, addressTracts);
  const acsFiles = files.filter((name) =>
    /^acs2024-state-\d{2}\.json$/.test(name),
  );
  if (!acsFiles.length) throw new Error("Missing raw ACS income evidence");
  const acsRows: GeographyEvidence["acsRows"] = await Promise.all(
    acsFiles.map(async (name) =>
      JSON.parse(await readFile(path.join(geo, name), "utf8")),
    ),
  );
  const arrestLocationRows = parse(auditCsv, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  if (arrestLocationRows.length !== receipt.arrestLocationAuditRows)
    throw new Error("Arrest location audit row count mismatch");
  const beatGeojson = JSON.parse(
    beatBytes.toString("utf8"),
  ) as GeographyEvidence["beatGeojson"];
  const enrichment = enrichBookings(arrests, {
    addressTracts,
    acsRows,
    arrestLocationRows,
    beatGeojson,
  });
  const normalized = normalizeWorkbook(arrests, charges, offenses, enrichment);
  const incomeReceipt = JSON.parse(
    await readFile(path.join(geo, "income-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    incomeReceipt.dataset !== "2024/acs/acs5" ||
    incomeReceipt.table !== "B19013" ||
    incomeReceipt.vintage !== "ACS2024_Current"
  )
    throw new Error(
      "Income evidence does not match declared ACS 2024 contract",
    );
  const hashes: Record<string, string> = { "arrests.xlsx": workbookSha };
  for (const filename of files)
    hashes[`geography/${filename}`] = digest(
      await readFile(path.join(geo, filename)),
    );
  const counts = (key: "beatStatus" | "incomeStatus") =>
    Object.values(enrichment).reduce<Record<string, number>>((result, item) => {
      result[item[key]] = (result[item[key]] ?? 0) + 1;
      return result;
    }, {});
  const provenance = {
    workbook: {
      name: "Arrest Data Since Jan-1-2020 redacted.xlsx",
      sha256: workbookSha,
    },
    evidenceSha256: hashes,
    income: incomeReceipt,
    beats: beatReceipt,
    arrestCoordinates: {
      method:
        "Prior source-hash-matched arrest location audit; HIGH/MEDIUM quality points only; beat recomputed from official polygons",
      source: receipt.addressPointService,
      sha256: receipt.arrestLocationAuditSha256,
    },
    interpretation: {
      arrest: "One distinct Booking_No",
      chargeRows: "Every supplied linked charge row, including repeated rows",
      distinctChargeRecords:
        "Distinct complete reported charge tuple within each booking; not a certified count of distinct legal charges",
      income:
        "Residential census tract median household income, not personal income",
      beat: "Arrest location mapped to supplied official polygons; historical effective dates not supplied",
    },
  };
  await mkdir(path.join(sourceDir, "evidence"), { recursive: true });
  await copyFile(workbook, path.join(sourceDir, "evidence", "arrests.xlsx"));
  await cp(geo, path.join(sourceDir, "evidence", "geography"), {
    recursive: true,
  });
  await writeFile(
    path.join(sourceDir, "arrests-normalized.jsonl"),
    normalized.arrests.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  await writeFile(
    path.join(sourceDir, "analytics-provenance.json"),
    JSON.stringify(
      {
        provenance,
        beatBoundaries: patrolBeatBoundaries(beatGeojson),
        audit: {
          ...normalized.audit,
          arrestBeatStatus: counts("beatStatus"),
          residentialIncomeStatus: counts("incomeStatus"),
        },
      },
      null,
      2,
    ),
  );
  logger?.info(
    `gov.irvingtx.arrests: ${normalized.arrests.length} bookings, ${charges.length} source charge rows, original workbook and geographic evidence preserved`,
  );
};
