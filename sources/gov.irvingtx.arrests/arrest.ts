// The per-arrest record the source keeps (ADR 0032): the arresting officer's
// name (resolved to an officer in run) plus derived breakdown dimensions. No
// arrestee identifier (booking name/address) is ever kept.
export type NormalizedArrest = {
  officerNames: string[];
  year: string;
  month: string;
  isoWeek: string;
  dayOfWeek: string;
  hour: string;
  district: string;
  offense: string;
  chargeLevel: string;
};

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

export type ArrestRow = Record<string, string | undefined>;
export type Charge = { offense: string; level: string };

export function deriveArrest(
  row: ArrestRow,
  chargeByBooking: (bookingNo: string) => Charge | undefined,
): NormalizedArrest {
  const primary = officerName(row.Arrest_Officer_Name);
  const date = parseDate(row.Arrest_Date ?? "");
  const charge = chargeByBooking(clean(row.Booking_No));
  return {
    officerNames: primary === undefined ? [] : [primary],
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
            new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
          ]!,
    hour: hourOf(row.Arrest_Time ?? ""),
    district: clean(row.District) || UNKNOWN,
    offense: charge?.offense ?? UNKNOWN,
    chargeLevel: charge?.level ?? UNKNOWN,
  };
}

const DIMENSIONS: { key: string; of: (a: NormalizedArrest) => string }[] = [
  { key: "by_year", of: (a) => a.year },
  { key: "by_month", of: (a) => a.month },
  { key: "by_iso_week", of: (a) => a.isoWeek },
  { key: "by_day_of_week", of: (a) => a.dayOfWeek },
  { key: "by_hour", of: (a) => a.hour },
  { key: "by_district", of: (a) => a.district },
  { key: "by_offense", of: (a) => a.offense },
  { key: "by_charge_level", of: (a) => a.chargeLevel },
];

// Count arrests per bucket for every dimension that has real data — a dimension
// whose values are entirely `unknown` is omitted (ADR 0032).
export function buildBreakdowns(
  arrests: readonly NormalizedArrest[],
): Record<string, Record<string, number>> {
  const breakdowns: Record<string, Record<string, number>> = {};
  for (const dimension of DIMENSIONS) {
    const counts: Record<string, number> = {};
    let hasKnown = false;
    for (const arrest of arrests) {
      const bucket = dimension.of(arrest);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
      if (bucket !== UNKNOWN) hasKnown = true;
    }
    if (hasKnown) breakdowns[dimension.key] = counts;
  }
  return breakdowns;
}

export function coverageOf(arrests: readonly NormalizedArrest[]): {
  totalArrests: number;
  firstMonth: string;
  lastMonth: string;
} {
  const months = arrests
    .map((arrest) => arrest.month)
    .filter((month) => month !== UNKNOWN)
    .sort();
  return {
    totalArrests: arrests.length,
    firstMonth: months[0] ?? UNKNOWN,
    lastMonth: months[months.length - 1] ?? UNKNOWN,
  };
}
