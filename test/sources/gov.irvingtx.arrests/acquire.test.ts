import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { acquire } from "../../../sources/gov.irvingtx.arrests/acquire.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function fixture(
  withNoMatch = false,
  withApartment = false,
  rawWhitespace = false,
) {
  const homeAddress = withApartment
    ? "1 MAIN ST, APT 2, IRVING, TX"
    : "1 MAIN ST, IRVING, TX";
  const workspace = await mkdtemp(path.join(tmpdir(), "irving-acquire-"));
  dirs.push(workspace);
  const input = path.join(workspace, "gov.irvingtx.arrests", "source");
  const geo = path.join(input, "geography");
  await mkdir(geo, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const arrests = workbook.addWorksheet("Arrest Data");
  arrests.addRow([
    "Booking_No",
    "Arrest_Officer_Name",
    "Arrest_Date",
    "Arrest_Time",
    "District",
    "Booking_Address",
    "arrest location",
  ]);
  arrests.addRow([
    "123",
    "OFFICER ONE",
    "2020-01-01",
    "12:00",
    "3",
    homeAddress,
    "2 MAIN ST",
  ]);
  arrests.addRow([
    "123",
    "OFFICER ONE",
    "2020-01-01",
    "12:00",
    "3",
    homeAddress,
    "2 MAIN ST",
  ]);
  if (withNoMatch)
    arrests.addRow([
      "456",
      "OFFICER ONE",
      "2020-01-02",
      "12:00",
      "3",
      "3 MAIN ST, IRVING, TX",
      "2 MAIN ST",
    ]);
  const charges = workbook.addWorksheet("Charges");
  charges.addRow(["Booking_No", "Charge", "Charge_Literal", "Level"]);
  charges.addRow(["123", "A", "FIRST", "MC"]);
  charges.addRow(["123", "A", "FIRST", "MC"]);
  charges.addRow(["123", "B", "SECOND", "MB"]);
  if (rawWhitespace) charges.addRow(["123", "A", "FIRST ", "MC"]);
  const offenses = workbook.addWorksheet("Offenses");
  offenses.addRow(["Booking_No", "Offense", "Description", "Offenses"]);
  offenses.addRow(["123", "X", "DESCRIPTION", "1"]);
  await workbook.xlsx.writeFile(path.join(input, "arrests.xlsx"));
  const sourceHash = hash(await readFile(path.join(input, "arrests.xlsx")));
  const audit = new ExcelJS.Workbook();
  const sheet = audit.addWorksheet("Beat Location Audit");
  sheet.getRow(4).values = [
    "arrest location",
    "Latitude",
    "Longitude",
    "Geocode_Method",
    "Geocode_Quality",
  ];
  sheet.addRow(["2 MAIN ST", 1, 1, "address_point", "HIGH"]);
  const method = audit.addWorksheet("Sources & Method");
  method.addRow(["SHA256", sourceHash]);
  await audit.xlsx.writeFile(path.join(geo, "arrest-location-audit.xlsx"));
  const auditCsv =
    "arrest location,Latitude,Longitude,Geocode_Method,Geocode_Quality\n2 MAIN ST,1,1,address_point,HIGH\n";
  await writeFile(path.join(geo, "arrest-location-audit.csv"), auditCsv);
  const addressId = hash(homeAddress).slice(0, 24);
  const json = async (name: string, value: unknown) =>
    writeFile(path.join(geo, name), JSON.stringify(value));
  const noMatchId = hash("3 MAIN ST, IRVING, TX").slice(0, 24);
  await json("address-tract-map.json", {
    ...(withNoMatch ? { [noMatchId]: { status: "geocoder_no_match" } } : {}),
    [addressId]: { status: "matched", quality: "Exact", geoid: "48113000100" },
  });
  await json("acs2024-state-48.json", [
    [
      "NAME",
      "B19013_001E",
      "B19013_001M",
      "B19013_001EA",
      "B19013_001MA",
      "state",
      "county",
      "tract",
    ],
    ["Tract", "45000", "1500", null, null, "48", "113", "000100"],
  ]);
  await json("income-receipt.json", {
    dataset: "2024/acs/acs5",
    estimatePeriod: "2020–2024",
    dollars: "2024 inflation-adjusted dollars",
    table: "B19013",
    benchmark: "Public_AR_Current",
    vintage: "ACS2024_Current",
    retrievedAt: "2026-09-28T20:45:28Z",
  });
  const shapes = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { Code: "21", BattalionC: "PD1", IsActive: 1 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
              [0, 0],
            ],
          ],
        },
      },
    ],
  };
  await json("beat-polygons.geojson", shapes);
  await json("beat-receipt.json", {
    sha256: hash(JSON.stringify(shapes)),
    url: "https://example.test/beats",
    featureCount: 1,
  });
  await json("acquisition-receipt.json", {
    sourceWorkbookSha256: sourceHash,
    incomeSourceWorkbookSha256: sourceHash,
    arrestLocationAuditSha256: hash(
      await readFile(path.join(geo, "arrest-location-audit.xlsx")),
    ),
    arrestLocationCsvSha256: hash(auditCsv),
    arrestLocationAuditSourceWorkbookSha256: sourceHash,
    arrestLocationAuditSheet: "Beat Location Audit",
    arrestLocationAuditHeaderRow: 4,
    arrestLocationAuditRows: 1,
    arrestLocationAuditCsvConversion: "Test fixture CSV",
    addressPointService: "https://example.test/addresses",
  });
  await writeFile(
    path.join(geo, "geocode-acs2024-01-input.csv"),
    `${addressId},${withApartment ? '"1 MAIN ST, APT 2"' : "1 MAIN ST"},IRVING,TX,\n` +
      (withNoMatch ? `${noMatchId},3 MAIN ST,IRVING,TX,\n` : ""),
  );
  await writeFile(
    path.join(geo, "geocode-acs2024-01-output.csv"),
    `${addressId},"1 MAIN ST, IRVING, TX",Match,Exact,"1 MAIN ST, IRVING, TX, 75060","1,1",1,L,48,113,000100,1000\n` +
      (withNoMatch ? `${noMatchId},"3 MAIN ST, IRVING, TX",No_Match\n` : ""),
  );
  return { workspace, input, geo, output: path.join(workspace, "output") };
}
describe("Irving complete acquisition", () => {
  it("preserves supplied charge literal whitespace instead of collapsing distinct source tuples", async () => {
    const f = await fixture(false, false, true);
    await acquire({
      sourceDir: f.output,
      state: f.workspace,
      env: { INTAKE_WORKSPACE: f.workspace },
      data: {} as never,
    });
    const rows = (
      await readFile(path.join(f.output, "arrests-normalized.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows[0].charges).toHaveLength(4);
    expect(rows[0].charges[3].offense).toBe("FIRST ");
  });
  it("validates source street addresses containing an apartment comma", async () => {
    const f = await fixture(false, true);
    await acquire({
      sourceDir: f.output,
      state: f.workspace,
      env: { INTAKE_WORKSPACE: f.workspace },
      data: {} as never,
    });
    const rows = (
      await readFile(path.join(f.output, "arrests-normalized.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows[0].enrichment.incomeTract).toBe("48113000100");
  });
  it("reads the actual mixed-width Census match and no-match response format", async () => {
    const f = await fixture(true);
    await acquire({
      sourceDir: f.output,
      state: f.workspace,
      env: { INTAKE_WORKSPACE: f.workspace },
      data: {} as never,
    });
    const rows = (
      await readFile(path.join(f.output, "arrests-normalized.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[1].enrichment.incomeStatus).toBe("geocoder_no_match");
  });
  it("retains every charge row, groups bookings, enriches geography and snapshots raw evidence", async () => {
    const f = await fixture();
    await acquire({
      sourceDir: f.output,
      state: path.join(f.workspace, "state"),
      env: { INTAKE_WORKSPACE: f.workspace },
      data: {} as never,
    });
    const records = (
      await readFile(path.join(f.output, "arrests-normalized.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].sourceRowCount).toBe(2);
    expect(records[0].charges).toEqual([
      { code: "A", offense: "FIRST", level: "MC" },
      { code: "A", offense: "FIRST", level: "MC" },
      { code: "B", offense: "SECOND", level: "MB" },
    ]);
    expect(records[0].enrichment).toMatchObject({
      beat: "21",
      incomeTract: "48113000100",
      income: { estimate: 45000, marginOfError: 1500 },
    });
    expect(
      await readFile(path.join(f.output, "evidence", "arrests.xlsx")),
    ).toEqual(await readFile(path.join(f.input, "arrests.xlsx")));
    const provenance = JSON.parse(
      await readFile(path.join(f.output, "analytics-provenance.json"), "utf8"),
    );
    expect(provenance.audit.sourceChargeRows).toBe(3);
    expect(JSON.stringify(provenance)).not.toContain("1 MAIN ST");
    expect(JSON.stringify(provenance)).not.toContain(f.workspace);
  });
  it("rejects income evidence from a different original workbook", async () => {
    const f = await fixture();
    const receipt = JSON.parse(
      await readFile(path.join(f.geo, "acquisition-receipt.json"), "utf8"),
    );
    receipt.incomeSourceWorkbookSha256 = "0".repeat(64);
    await writeFile(
      path.join(f.geo, "acquisition-receipt.json"),
      JSON.stringify(receipt),
    );
    await expect(
      acquire({
        sourceDir: f.output,
        state: f.workspace,
        env: { INTAKE_WORKSPACE: f.workspace },
        data: {} as never,
      }),
    ).rejects.toThrow(/income.*workbook/i);
  });
  it("rejects a cached tract unsupported by the raw geocoder response", async () => {
    const f = await fixture();
    const file = path.join(f.geo, "address-tract-map.json");
    const mapping = JSON.parse(await readFile(file, "utf8"));
    for (const value of Object.values(mapping) as { geoid: string }[])
      value.geoid = "48113999999";
    await writeFile(file, JSON.stringify(mapping));
    await expect(
      acquire({
        sourceDir: f.output,
        state: f.workspace,
        env: { INTAKE_WORKSPACE: f.workspace },
        data: {} as never,
      }),
    ).rejects.toThrow(/geocoder.*tract/i);
  });
});
