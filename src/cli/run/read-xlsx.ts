import ExcelJS from "exceljs";

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
    headers[col] = String(cell.value ?? "").trim();
  });

  const rows: Array<Record<string, string>> = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, string> = {};
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      const value = row.getCell(col).value;
      record[header] =
        value === null || value === undefined ? "" : String(value).trim();
    }
    rows.push(record);
  }
  return rows;
}
