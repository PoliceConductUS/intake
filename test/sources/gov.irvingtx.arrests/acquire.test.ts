import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { acquire } from "../../../sources/gov.irvingtx.arrests/acquire.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function createWorkbook(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const charges = workbook.addWorksheet("Charges");
  charges.addRow(["Booking_No", "Charge_Literal", "Level"]);
  charges.addRow(["123", "PUBLIC INTOXICATION", "MC"]);
  const arrests = workbook.addWorksheet("Arrest Data");
  arrests.addRow([
    "Arrest_Officer_Name",
    "Arrest_Date",
    "Arrest_Time",
    "Booking_No",
    "District",
  ]);
  arrests.addRow(["OFFICER ONE", "2020-01-01", "12:00", "123", "3"]);
  await workbook.xlsx.writeFile(file);
}

describe("Irving arrests acquire", () => {
  it("reads the workbook from the fixed source-workspace path", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "irving-workspace-"));
    tempDirs.push(workspace);
    const inputDir = path.join(workspace, "gov.irvingtx.arrests", "source");
    const sourceDir = path.join(workspace, "command-output");
    await mkdir(inputDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await createWorkbook(path.join(inputDir, "arrests.xlsx"));

    await acquire({
      sourceDir,
      state: path.join(workspace, "state"),
      env: { INTAKE_WORKSPACE: workspace },
      data: {} as never,
    });

    const normalized = await readFile(
      path.join(sourceDir, "arrests-normalized.jsonl"),
      "utf8",
    );
    expect(JSON.parse(normalized)).toMatchObject({
      officerNames: ["OFFICER ONE"],
      offense: "PUBLIC INTOXICATION",
      chargeLevel: "MC",
    });
  });

  it("fails with the canonical path when the workspace workbook is missing", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "irving-workspace-"));
    tempDirs.push(workspace);

    await expect(
      acquire({
        sourceDir: path.join(workspace, "command-output"),
        state: path.join(workspace, "state"),
        env: { INTAKE_WORKSPACE: workspace },
        data: {} as never,
      }),
    ).rejects.toThrow(
      path.join(workspace, "gov.irvingtx.arrests", "source", "arrests.xlsx"),
    );
  });
});
