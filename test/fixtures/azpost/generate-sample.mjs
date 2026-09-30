// Generates test/fixtures/azpost/officer-list-sample.xlsx
//
// Run: node test/fixtures/azpost/generate-sample.mjs
//
// This script is committed alongside the generated .xlsx fixture so the
// binary file is reproducible from source.
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const outputPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "officer-list-sample.xlsx",
);

const headers = [
  "AGENCY",
  "POST ID",
  "LAST",
  "FIRST",
  "MIDDLE",
  "APPOINTED ON",
  "TERMINATED ON",
  "TERM DESC",
  "CERTIFICATION",
  "CERT TYPE",
];

// POST ID is a numeric cell (not a string) on the first row, and APPOINTED ON
// is a real Date cell on that same row, so the fixture exercises the
// non-string cell shapes `readXlsx` must coerce cleanly (see
// src/cli/run/read-xlsx.ts).
const rows = [
  [
    "Tempe PD",
    1001,
    "Woodward",
    "Skip",
    "L",
    new Date(Date.UTC(2020, 0, 15)),
    "",
    "",
    "",
    "",
  ],
  ["Mesa PD", "1002", "Denney", "Marc", "E", "", "", "", "", ""],
  ["Mesa PD", "1002", "Denney", "Marc", "E", "", "", "", "", ""],
  ["Tempe PD", "", "Nokey", "Ann", "", "", "", "", "", ""],
];

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Officer List");
sheet.addRow(headers);
for (const row of rows) {
  sheet.addRow(row);
}

await workbook.xlsx.writeFile(outputPath);
console.log(`Wrote ${outputPath}`);
