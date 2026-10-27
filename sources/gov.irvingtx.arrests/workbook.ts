import ExcelJS from "exceljs";
import { assertRequiredColumns } from "../../src/cli/transform/assert-required-columns.js";

/** Read child source fields verbatim: whitespace is part of an exact source tuple. */
export async function readChildSheets(file: string): Promise<{
  charges: Record<string, string>[];
  offenses: Record<string, string>[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  function sheet(name: string, required: string[]): Record<string, string>[] {
    const worksheet = workbook.getWorksheet(name);
    if (!worksheet) throw new Error(`Missing source worksheet ${name}`);
    const headers: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col] = cell.text.trim();
    });
    assertRequiredColumns(
      headers.filter(Boolean),
      required,
      `Worksheet ${name}`,
    );
    const rows: Record<string, string>[] = [];
    for (let index = 2; index <= worksheet.rowCount; index++) {
      const record: Record<string, string> = {};
      for (let col = 1; col < headers.length; col++) {
        const header = headers[col];
        if (!header) continue;
        const value = worksheet.getRow(index).getCell(col).value;
        if (value === null || value === undefined) record[header] = "";
        else if (typeof value === "string") record[header] = value;
        else if (typeof value === "number") record[header] = String(value);
        else
          throw new Error(
            `Unsupported raw source cell type in ${name} row ${index}, column ${header}`,
          );
      }
      rows.push(record);
    }
    return rows;
  }
  return {
    charges: sheet("Charges", [
      "Booking_No",
      "Charge",
      "Charge_Literal",
      "Level",
    ]),
    offenses: sheet("Offenses", [
      "Booking_No",
      "Offense",
      "Description",
      "Offenses",
    ]),
  };
}
