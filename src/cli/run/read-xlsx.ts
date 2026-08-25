import ExcelJS from "exceljs";

/**
 * Coerces an exceljs cell value to a trimmed string, handling the common
 * non-string shapes exceljs produces (dates, formulas, rich text, and
 * hyperlinks) before falling back to `String(value)`. Deterministic: never
 * reads the clock or generates randomness.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().trim();

  if (typeof value === "object") {
    if ("result" in value) {
      return cellToString(
        (value as { result?: ExcelJS.CellValue }).result ?? "",
      );
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((run) => run.text)
        .join("")
        .trim();
    }
    if ("text" in value) {
      return cellToString((value as { text?: ExcelJS.CellValue }).text ?? "");
    }
  }

  return String(value).trim();
}

/**
 * Reads a sheet of an .xlsx file into an array of records keyed by the header
 * row (row 1). Every cell is coerced to a trimmed string; missing cells become
 * "". Deterministic: no network, no clock, no randomness.
 *
 * `sheet` selects the worksheet by name (case-sensitive) when provided;
 * omitting it reads the first worksheet (the historical behavior). A named
 * sheet that does not exist throws so a mis-typed sheet name fails loudly
 * rather than silently returning no rows.
 *
 * `requiredColumns`, when given, must all appear in the header row — a missing
 * one throws (listing what is missing and what is available). Without it, a
 * renamed or mis-typed column reads as "" on every row and the source silently
 * drops all of them; declaring the columns a source reads turns that into a
 * loud failure at the read boundary.
 */
export async function readXlsx(
  filePath: string,
  sheet?: string,
  requiredColumns?: readonly string[],
): Promise<Array<Record<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet =
    sheet === undefined ? workbook.worksheets[0] : workbook.getWorksheet(sheet);
  if (sheet !== undefined && !worksheet) {
    const available = workbook.worksheets.map((ws) => ws.name).join(", ");
    throw new Error(
      `Worksheet "${sheet}" not found in ${filePath} (available: ${available}).`,
    );
  }
  if (!worksheet) return [];

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellToString(cell.value);
  });

  if (requiredColumns !== undefined && requiredColumns.length > 0) {
    const present = new Set(headers.filter((header) => header !== ""));
    const missing = requiredColumns.filter((column) => !present.has(column));
    if (missing.length > 0) {
      const sheetName = worksheet.name;
      throw new Error(
        `Worksheet "${sheetName}" in ${filePath} is missing required column(s): ` +
          `${missing.join(", ")} (available: ${[...present].join(", ")}).`,
      );
    }
  }

  const rows: Array<Record<string, string>> = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const record: Record<string, string> = {};
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      record[header] = cellToString(row.getCell(col).value);
    }
    rows.push(record);
  }
  return rows;
}
