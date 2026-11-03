import ExcelJS from "exceljs";

export const spreadsheetUrl =
  "https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/edit?gid=0#gid=0";
export const exportUrl =
  "https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/export?format=xlsx";
export type SourceRow = {
  row: number;
  name: string;
  title: string;
  state: string;
  category: string;
  outcome: string;
  linkText: string;
  url: string;
};

// Acquisition reads this publisher's original workbook, including hyperlink
// targets. Transforms consume the saved JSON, not a rewritten spreadsheet.
export async function readSpreadsheet(file: string): Promise<SourceRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet("GENERAL");
  if (!sheet) throw new Error("Missing GENERAL worksheet");
  const expected = [
    "Name:",
    "Title:",
    "State:",
    "Form of Violence:",
    "Arrest or Sentence",
    "Link:",
  ];
  expected.forEach((header, index) => {
    if (
      sheet
        .getRow(3)
        .getCell(index + 1)
        .text.trim() !== header
    ) {
      throw new Error(`Unexpected spreadsheet header in column ${index + 1}`);
    }
  });
  const rows: SourceRow[] = [];
  for (let row = 4; row <= sheet.rowCount; row++) {
    const cells = sheet.getRow(row);
    const text = (col: number) => cells.getCell(col).text.trim();
    if (!text(6)) continue;
    const value = cells.getCell(6).value;
    const url =
      value && typeof value === "object" && "hyperlink" in value
        ? value.hyperlink
        : text(6);
    if (!/^https?:\/\//.test(url))
      throw new Error(`Invalid article URL at row ${row}: ${url}`);
    rows.push({
      row,
      name: text(1),
      title: text(2),
      state: text(3),
      category: text(4),
      outcome: text(5),
      linkText: text(6),
      url,
    });
  }
  return rows;
}
