import { z } from "zod";
const IncomeSchema = z
  .object({
    estimate: z.number().nullable(),
    marginOfError: z.number().nullable(),
    annotation: z.string().nullable(),
    marginOfErrorAnnotation: z.string().nullable(),
    topcoded: z.boolean(),
  })
  .strict();
const EnrichmentSchema = z
  .object({
    beat: z.string().nullable(),
    beatStatus: z.string(),
    incomeTract: z.string().nullable(),
    income: IncomeSchema.nullable(),
    incomeStatus: z.string(),
  })
  .strict();
export type BookingEnrichment = z.infer<typeof EnrichmentSchema>;
const ChargeSchema = z
  .object({ code: z.string(), offense: z.string(), level: z.string() })
  .strict();
const OffenseSchema = z
  .object({
    code: z.string(),
    description: z.string(),
    sourceOffenses: z.string(),
  })
  .strict();
const NormalizedArrestSchema = z
  .object({
    bookingNo: z.string().min(1),
    sourceRowCount: z.number().int().positive(),
    officerNames: z.array(z.string()),
    year: z.string(),
    month: z.string(),
    isoWeek: z.string(),
    dayOfWeek: z.string(),
    hour: z.string(),
    sourceDistrict: z.string(),
    enrichment: EnrichmentSchema,
    charges: z.array(ChargeSchema),
    offenses: z.array(OffenseSchema),
  })
  .strict();
export type NormalizedArrest = z.infer<typeof NormalizedArrestSchema>;
export const parseNormalizedArrest = (value: unknown): NormalizedArrest =>
  NormalizedArrestSchema.parse(value);
const UNKNOWN = "unknown";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clean(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "NULL" ? "" : trimmed;
}

// "JONES,MATTHEW" (LAST,FIRST) → "MATTHEW JONES" so the name resolver sees the
// same first-last order it scores the roster in. A name without a comma passes
// through; a blank/NULL name yields no officer.
function officerName(raw: string | undefined): string | undefined {
  const value = clean(raw);
  if (value === "") return undefined;
  const comma = value.indexOf(",");
  if (comma === -1) return value;
  const last = value.slice(0, comma).trim();
  const first = value.slice(comma + 1).trim();
  return `${first} ${last}`.trim();
}

// The date cell arrives ISO-ish ("2020-01-01T00:00:00.000Z" or "2020-01-01 …").
function parseDate(
  raw: string,
): { year: number; month: number; day: number } | undefined {
  const match = clean(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match === null) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function hourOf(raw: string): string {
  const match = clean(raw).match(/^(\d{1,2}):/);
  return match === null ? UNKNOWN : String(Number(match[1])).padStart(2, "0");
}

export type ArrestRow = Record<string, string>;
export function normalizeWorkbook(
  arrestRows: ArrestRow[],
  chargeRows: ArrestRow[],
  offenseRows: ArrestRow[],
  enrichment: Record<string, BookingEnrichment>,
): { arrests: NormalizedArrest[]; audit: Record<string, number> } {
  const byBooking = new Map<string, NormalizedArrest>();
  for (const row of arrestRows) {
    const bookingNo = row.Booking_No;
    if (!bookingNo?.trim()) throw new Error("Missing Booking_No");
    const bookingEnrichment = enrichment[bookingNo];
    if (bookingEnrichment === undefined)
      throw new Error("Missing booking enrichment");
    z.object({
      Booking_No: z.string().min(1),
      Arrest_Date: z.string(),
      Arrest_Time: z.string(),
      District: z.string(),
      Arrest_Officer_Name: z.string(),
    }).parse(row);
    const date = parseDate(row.Arrest_Date);
    const dimensions = {
      year: date === undefined ? UNKNOWN : String(date.year),
      month:
        date === undefined
          ? UNKNOWN
          : `${date.year}-${String(date.month).padStart(2, "0")}`,
      isoWeek:
        date === undefined ? UNKNOWN : isoWeek(date.year, date.month, date.day),
      dayOfWeek:
        date === undefined
          ? UNKNOWN
          : WEEKDAYS[
              new Date(
                Date.UTC(date.year, date.month - 1, date.day),
              ).getUTCDay()
            ]!,
      hour: hourOf(row.Arrest_Time ?? ""),
      sourceDistrict: clean(row.District) || UNKNOWN,
    };
    const name = officerName(row.Arrest_Officer_Name);
    const previous = byBooking.get(bookingNo);
    if (previous !== undefined) {
      for (const key of Object.keys(dimensions) as (keyof typeof dimensions)[])
        if (previous[key] !== dimensions[key])
          throw new Error(`conflicting booking dimension ${key}`);
      previous.sourceRowCount++;
      if (name !== undefined && !previous.officerNames.includes(name))
        previous.officerNames.push(name);
    } else {
      byBooking.set(bookingNo, {
        bookingNo,
        sourceRowCount: 1,
        officerNames: name === undefined ? [] : [name],
        ...dimensions,
        enrichment: bookingEnrichment,
        charges: [],
        offenses: [],
      });
    }
  }
  let orphanChargeRows = 0,
    orphanOffenseRows = 0;
  for (const row of chargeRows) {
    z.object({
      Booking_No: z.string().min(1),
      Charge: z.string(),
      Charge_Literal: z.string(),
      Level: z.string(),
    }).parse(row);
    const arrest = byBooking.get(row.Booking_No ?? "");
    if (arrest === undefined) {
      orphanChargeRows++;
      continue;
    }
    arrest.charges.push({
      code: row.Charge ?? "",
      offense: row.Charge_Literal ?? "",
      level: row.Level ?? "",
    });
  }
  for (const row of offenseRows) {
    z.object({
      Booking_No: z.string().min(1),
      Offense: z.string(),
      Description: z.string(),
      Offenses: z.string(),
    }).parse(row);
    const arrest = byBooking.get(row.Booking_No ?? "");
    if (arrest === undefined) {
      orphanOffenseRows++;
      continue;
    }
    arrest.offenses.push({
      code: row.Offense ?? "",
      description: row.Description ?? "",
      sourceOffenses: row.Offenses ?? "",
    });
  }
  return {
    arrests: [...byBooking.values()].map(parseNormalizedArrest),
    audit: {
      sourceArrestRows: arrestRows.length,
      sourceChargeRows: chargeRows.length,
      sourceOffenseRows: offenseRows.length,
      orphanChargeRows,
      orphanOffenseRows,
    },
  };
}
type Counts = Record<string, number>;
const increment = (counts: Counts, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};
const distinct = <T>(rows: T[]): T[] => [
  ...new Map(rows.map((row) => [JSON.stringify(row), row])).values(),
];
function distributions(
  arrests: readonly NormalizedArrest[],
): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  for (const dimension of ["offense", "level"] as const) {
    const rows: Counts = {},
      records: Counts = {},
      bookings: Counts = {};
    for (const arrest of arrests) {
      for (const charge of arrest.charges) increment(rows, charge[dimension]);
      for (const charge of distinct(arrest.charges))
        increment(records, charge[dimension]);
      for (const category of new Set(
        arrest.charges.map((charge) => charge[dimension]),
      ))
        increment(bookings, category);
    }
    result[`charge_rows_by_${dimension}`] = rows;
    result[`distinct_charge_records_by_${dimension}`] = records;
    result[`arrests_by_${dimension}`] = bookings;
  }
  return result;
}
export function buildProfile(arrests: readonly NormalizedArrest[]) {
  if (
    new Set(arrests.map((arrest) => arrest.bookingNo)).size !== arrests.length
  )
    throw new Error("Duplicate normalized booking");
  const months = arrests
    .map((arrest) => arrest.month)
    .filter((month) => month !== UNKNOWN)
    .sort();
  const coverage = {
    totalArrests: arrests.length,
    sourceArrestRows: arrests.reduce(
      (sum, arrest) => sum + arrest.sourceRowCount,
      0,
    ),
    chargeRows: arrests.reduce((sum, arrest) => sum + arrest.charges.length, 0),
    distinctChargeRecords: arrests.reduce(
      (sum, arrest) => sum + distinct(arrest.charges).length,
      0,
    ),
    arrestsWithLinkedCharges: arrests.filter(
      (arrest) => arrest.charges.length > 0,
    ).length,
    arrestsWithoutLinkedCharges: arrests.filter(
      (arrest) => arrest.charges.length === 0,
    ).length,
    offenseRows: arrests.reduce(
      (sum, arrest) => sum + arrest.offenses.length,
      0,
    ),
    distinctOffenseRecords: arrests.reduce(
      (sum, arrest) => sum + distinct(arrest.offenses).length,
      0,
    ),
    arrestsWithLinkedOffenses: arrests.filter(
      (arrest) => arrest.offenses.length > 0,
    ).length,
    firstMonth: months[0] ?? UNKNOWN,
    lastMonth: months.at(-1) ?? UNKNOWN,
  };
  const dimensions: Record<string, (arrest: NormalizedArrest) => string> = {
    by_year: (a) => a.year,
    by_month: (a) => a.month,
    by_iso_week: (a) => a.isoWeek,
    by_day_of_week: (a) => a.dayOfWeek,
    by_hour: (a) => a.hour,
    by_source_district: (a) => a.sourceDistrict,
    by_arrest_beat: (a) => a.enrichment.beat ?? UNKNOWN,
    by_residential_tract: (a) => a.enrichment.incomeTract ?? UNKNOWN,
    by_beat_status: (a) => a.enrichment.beatStatus,
    by_income_status: (a) => a.enrichment.incomeStatus,
  };
  const counts: Record<string, Counts> = distributions(arrests);
  for (const [key, of] of Object.entries(dimensions)) {
    const buckets: Counts = {};
    for (const arrest of arrests) increment(buckets, of(arrest));
    counts[key] = buckets;
  }
  const incomes: Record<string, BookingEnrichment["income"]> = {};
  const groups = new Map<string, NormalizedArrest[]>();
  for (const arrest of arrests) {
    const e = arrest.enrichment;
    if (e.incomeTract !== null && e.income !== null) {
      if (
        incomes[e.incomeTract] !== undefined &&
        JSON.stringify(incomes[e.incomeTract]) !== JSON.stringify(e.income)
      )
        throw new Error("Conflicting tract income");
      incomes[e.incomeTract] = e.income;
    }
    const key = JSON.stringify([
      arrest.month,
      e.beat,
      e.incomeTract,
      e.incomeStatus,
      e.beatStatus,
    ]);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [arrest]);
    else list.push(arrest);
  }
  const cells = [...groups.values()].map((group) => {
    const first = group[0]!;
    return {
      month: first.month,
      beat: first.enrichment.beat,
      incomeTract: first.enrichment.incomeTract,
      incomeStatus: first.enrichment.incomeStatus,
      beatStatus: first.enrichment.beatStatus,
      arrests: group.length,
      chargeRows: group.reduce((sum, a) => sum + a.charges.length, 0),
      distinctChargeRecords: group.reduce(
        (sum, a) => sum + distinct(a.charges).length,
        0,
      ),
      ...distributions(group),
    };
  });
  const breakdowns: Record<string, unknown> = {
    ...counts,
    residential_income_by_tract: incomes,
    cells,
  };
  return { coverage, breakdowns };
}
