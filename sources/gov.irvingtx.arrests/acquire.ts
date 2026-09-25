import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { readXlsx } from "../../src/cli/transform/read-xlsx.js";
import { deriveArrest, type ArrestRow, type Charge } from "./arrest.js";

// acquire owns the read half (ADR 0032): read the FOIA arrest workbook (its path
// in IRVING_ARRESTS_FILE, never committed — it carries arrestee PII), join each
// arrest to its primary charge, and write a scrubbed normalized record per
// arrest. Only the arresting officer's name and derived breakdown dimensions
// survive; booking name/address never leave this phase.
export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  logger,
}: AcquireDeps): Promise<void> => {
  const file = env.IRVING_ARRESTS_FILE;
  if (file === undefined || file.trim() === "") {
    throw new Error(
      "gov.irvingtx.arrests: IRVING_ARRESTS_FILE is required (path to the FOIA arrest workbook).",
    );
  }

  // Primary charge per booking (the first charge row wins): booking → offense.
  // readXlsx fails loud if any declared column is missing (a renamed FOIA header),
  // and coerces every cell to a trimmed string, so an empty cell is "".
  const chargeByBooking = new Map<string, Charge>();
  for (const charge of await readXlsx(file, "Charges", [
    "Booking_No",
    "Charge_Literal",
    "Level",
  ])) {
    const booking = charge.Booking_No;
    if (booking !== "" && !chargeByBooking.has(booking)) {
      chargeByBooking.set(booking, {
        offense: charge.Charge_Literal || "unknown",
        level: charge.Level || "unknown",
      });
    }
  }

  const arrestRows = (await readXlsx(file, "Arrest Data", [
    "Arrest_Officer_Name",
    "Arrest_Date",
    "Arrest_Time",
    "Booking_No",
    "District",
  ])) as ArrestRow[];
  const normalized = arrestRows
    .map((row) => deriveArrest(row, (booking) => chargeByBooking.get(booking)))
    .filter((arrest) => arrest.officerNames.length > 0);

  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, "arrests-normalized.jsonl"),
    normalized.map((arrest) => JSON.stringify(arrest)).join("\n"),
    "utf8",
  );
  logger?.info(
    `gov.irvingtx.arrests: normalized ${normalized.length} arrests (of ${arrestRows.length} rows); ${chargeByBooking.size} charges joined.`,
  );
};
