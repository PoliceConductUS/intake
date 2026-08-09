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
 * Reads sheet 1 of an .xlsx file into an array of records keyed by the
 * header row (row 1). Every cell is coerced to a trimmed string; missing
 * cells become "". Deterministic: no network, no clock, no randomness.
 */
export async function readXlsx(
  filePath: string,
): Promise<Array<Record<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellToString(cell.value);
  });

  const rows: Array<Record<string, string>> = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
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
