import ExcelJS from "exceljs";
import path from "node:path";

export const WORKBOOK_FILES = {
  discipline: "Final Disciplinary Actions item 5 DL 9-26.xlsx",
  roster:
    "Law Enforcement Agencies request item 2 -peace officer roster data DL 2026.xlsx",
  history:
    "Law Enforcement Agencies request item 3 agency history DL 2026.xlsx",
};
export type WorkbookRow = { sourceRow: number; values: unknown[] };
export type EmploymentHistory = {
  sourceRow: number;
  agencyName: string;
  startDate: string;
  endDate: string;
};
export type DisciplinePerson = {
  licenseNumber: string;
  name: string;
  sourceRow: number;
  history: EmploymentHistory[];
};
function required(value: unknown, label: string, row: number): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  )
    throw new Error(`Missing ${label} at workbook row ${row}`);
  return String(value).trim();
}
function license(value: unknown, row: number): string {
  const result = required(value, "license number", row);
  if (!/^\d+$/.test(result))
    throw new Error(`Invalid license number ${result} at row ${row}`);
  return result;
}
function date(value: unknown, row: number): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = required(value, "date", row);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) throw new Error(`Invalid date ${raw} at row ${row}`);
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  const parsed = new Date(iso);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
  )
    throw new Error(`Invalid date ${raw} at row ${row}`);
  return iso;
}
export function parseDisciplineRows(rows: WorkbookRow[]): DisciplinePerson[] {
  const seen = new Set<string>();
  const people: DisciplinePerson[] = [];
  for (const { sourceRow, values } of rows) {
    if (values[0] === "Total") continue;
    const number = license(values[1], sourceRow);
    if (seen.has(number))
      throw new Error(
        `Duplicate discipline license ${number} at row ${sourceRow}`,
      );
    if (values[4] !== true)
      throw new Error(`Expected Has Been Disciplined flag at row ${sourceRow}`);
    seen.add(number);
    people.push({
      licenseNumber: number,
      name: required(values[0], "name", sourceRow),
      sourceRow,
      history: [],
    });
  }
  return people;
}
export function parseHistoryRows(
  rows: WorkbookRow[],
  licenses: Set<string>,
): Map<string, EmploymentHistory[]> {
  const result = new Map<string, EmploymentHistory[]>();
  let current: string | undefined;
  for (const { sourceRow, values } of rows) {
    if (values[1] === "Subtotal" || values[1] === "Total") {
      current = undefined;
      continue;
    }
    if (values[1] != null && values[1] !== "")
      current = license(values[1], sourceRow);
    if (!current)
      throw new Error(`Missing grouped history license at row ${sourceRow}`);
    if (!licenses.has(current)) continue;
    if (values[8] !== "Former")
      throw new Error(`Expected former history at row ${sourceRow}`);
    const history = {
      sourceRow,
      agencyName: required(values[5], "agency", sourceRow),
      startDate: date(values[7], sourceRow),
      endDate: date(values[9], sourceRow),
    };
    const entries = result.get(current) ?? [];
    entries.push(history);
    result.set(current, entries);
  }
  return result;
}
async function readRows(
  file: string,
  headers: Record<number, string>,
): Promise<WorkbookRow[]> {
  const rows: WorkbookRow[] = [];
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
  });
  for await (const sheet of workbook) {
    for await (const row of sheet) {
      const values = (row.values as unknown[]).slice(1);
      if (row.number === 1) {
        validateWorkbookHeader(values, headers);
        continue;
      }
      if (values.some((value) => value != null && value !== ""))
        rows.push({ sourceRow: row.number, values });
    }
  }
  return rows;
}
export async function readDisciplineWorkbooks(
  directory: string,
): Promise<DisciplinePerson[]> {
  const people = parseDisciplineRows(
    await readRows(path.join(directory, WORKBOOK_FILES.discipline), {
      0: "Licensee Full Name",
      1: "License - POST: Number",
      2: "Status",
      3: "Effective Date",
      4: "Has Been Disciplined",
    }),
  );
  const roster = new Map<string, WorkbookRow>();
  for (const row of await readRows(
    path.join(directory, WORKBOOK_FILES.roster),
    {
      1: "Licensee Full Name",
      3: "License - POST: Number",
      4: "Status",
      5: "Primary Agency Name",
      6: "Original License Date",
      7: "Effective Date",
      8: "Expiration Date",
      9: "Date Inactive",
    },
  )) {
    if (row.values[1] === "Total") continue;
    const number = license(row.values[3], row.sourceRow);
    if (roster.has(number))
      throw new Error(
        `Duplicate roster license ${number} at row ${row.sourceRow}`,
      );
    roster.set(number, row);
  }
  const history = parseHistoryRows(
    await readRows(path.join(directory, WORKBOOK_FILES.history), {
      1: "License Number  ↑",
      3: "Last Name",
      4: "First Name",
      5: "Law Enforcement Agency",
      6: "Status",
      7: "Start Date",
      8: "Agency Status",
      9: "Date Terminated",
    }),
    new Set(people.map((p) => p.licenseNumber)),
  );
  for (const person of people) {
    const row = roster.get(person.licenseNumber);
    if (
      !row ||
      required(row.values[1], "roster name", row.sourceRow) !== person.name
    )
      throw new Error(
        `Discipline/roster mismatch for license ${person.licenseNumber}`,
      );
    person.history = history.get(person.licenseNumber) ?? [];
  }
  return people;
}

export function validateWorkbookHeader(
  values: unknown[],
  expected: Record<number, string>,
): void {
  for (const [index, label] of Object.entries(expected))
    if (values[Number(index)] !== label)
      throw new Error(
        `Unexpected workbook header at column ${Number(index) + 1}: expected ${label}`,
      );
}
