import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../../sources/mn-post/config.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
  LicensingAuthoritySpec,
  LicenseSpec,
  DisciplineSpec,
  DisciplineAgencyOfficerSpec,
  CoverageLinkSpec,
  CoverageLinkAgencyOfficerSpec,
} from "../../src/shared/io/index.js";
import type { SourceManifest } from "../../src/cli/run/source-run.js";

// The mn-post source reads its inputs from files under the source folder (an
// `agency-ids.yaml` name→id map, an `agencies.csv` address list, and one
// `*.list.yaml` roster per agency), so the fixture writes those files to a temp
// dir and drives `run()` with their paths. Two agencies: "Alpha Police Dept."
// (in the CSV, with an address) and "Beta County Sheriff" (absent from the CSV,
// so it falls back to state "MN" with no address). Officer 0031 works at both.
const agencyIds = [
  "Alpha Police Dept.:",
  "  id: a2jALPHA",
  "Beta County Sheriff:",
  "  id: a2jBETA",
].join("\n");

const agenciesCsv = [
  "Agency,Agency Type,Chief Law Enforcement Officer,Address,City,State,Zip,Phone,Email",
  "Alpha Police Dept.,Police,Jane Chief,100 Main St,Alphaville,MN,55111,555-1000,chief@alpha.mn",
].join("\n");

// Roster row helper — mirrors the scraped `*.list.yaml` shape.
function row(fields: Record<string, string | boolean>): string {
  return Object.entries(fields)
    .map(
      ([k, v]) => `  ${k}: ${typeof v === "boolean" ? v : JSON.stringify(v)}`,
    )
    .join("\n");
}

const alphaRoster = [
  "- ",
  row({
    name: "Smith, John Robert",
    contactId: "0031",
    licenseId: "a2jLIC31",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2010-05-01",
    disciplinaryAction: false,
  }),
  "- ",
  row({
    name: "Jones, Mary",
    contactId: "0032",
    licenseId: "a2jLIC32",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2015-03-15",
    disciplinaryAction: false,
  }),
  // disciplined -> still imported; discipline is never a reason to drop an officer
  "- ",
  row({
    name: "Bad, Actor",
    contactId: "0099",
    licenseId: "a2jLIC99",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2012-01-01",
    disciplinaryAction: true,
  }),
].join("\n");

const betaRoster = [
  // same officer 0031, second agency -> one Personnel, a second assignment
  "- ",
  row({
    name: "Smith, John Robert",
    contactId: "0031",
    licenseId: "a2jLIC31",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2010-05-01",
    disciplinaryAction: false,
  }),
  // blank contactId -> skipped (no stable person id)
  "- ",
  row({
    name: "No, Id",
    contactId: "",
    licenseId: "a2jLICXX",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2018-08-08",
    disciplinaryAction: false,
  }),
].join("\n");

// Officer 0031's detail JSON carries a disciplinary order. 0031 is assigned to
// both agencies, so it attributes to both. 0032's detail has the no-discipline
// sentinel string and must produce nothing.
const detail0031 = JSON.stringify({
  disciplinaryActions: [
    {
      contactId: "0031",
      caseNumber: "PB24-1-01",
      documentName: "SACO",
      documentURL: "https://example.mn/orders/PB24-1-01.pdf",
      effectiveDate: "2024-03-01",
      expirationDate: "2026-03-01",
      complaintId: "cmp-001",
    },
  ],
  activeEmployment: [],
});
const detail0032 = JSON.stringify({
  disciplinaryActions: "No POST Disciplinary Actions found",
});

let sourceDir: string;
let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "mn-post-"));
  sourceDir = path.join(workspace, "source");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "agency-ids.yaml"), agencyIds);
  await writeFile(path.join(sourceDir, "agencies.csv"), agenciesCsv);
  await writeFile(
    path.join(sourceDir, "alpha-police-dept-000000000001.list.yaml"),
    alphaRoster,
  );
  await writeFile(
    path.join(sourceDir, "beta-county-sheriff-000000000002.list.yaml"),
    betaRoster,
  );
  await writeFile(
    path.join(sourceDir, "a2jofficer0031-detail.json"),
    detail0031,
  );
  await writeFile(
    path.join(sourceDir, "a2jofficer0032-detail.json"),
    detail0032,
  );
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function runFixture(): Promise<SourceManifest> {
  const files = await readdir(sourceDir);
  return run({
    paths: files.map((f) => path.join(sourceDir, f)),
    readXlsx: async () => [],
    state: "/unused",
    emit: async () => {},
  });
}

function recordsOf(manifest: SourceManifest, kind: string) {
  return manifest.artifacts.find((a) => a.kind === kind)!.records;
}

describe("mn-post run", () => {
  it("emits the licensing kinds in dependency order", async () => {
    const manifest = await runFixture();
    expect(manifest.artifacts.map((a) => a.kind)).toEqual([
      "LicensingAuthorities",
      "Agencies",
      "Personnel",
      "Licenses",
      "AgencyPersonnel",
      "Disciplines",
      "DisciplineAgencyOfficers",
      "CoverageLinks",
      "CoverageLinkAgencyOfficers",
    ]);
  });

  it("emits the single MN POST licensing authority", async () => {
    const authorities = recordsOf(await runFixture(), "LicensingAuthorities");
    expect(Object.keys(authorities)).toEqual(["mn-post"]);
    expect(authorities["mn-post"].spec).toMatchObject({
      abbreviation: "MN POST",
      location_path_id: "mn",
    });
    expect(
      LicensingAuthoritySpec.safeParse(authorities["mn-post"].spec).success,
    ).toBe(true);
  });

  it("maps agencies keyed by a2j id, joining CSV addresses and defaulting state to MN", async () => {
    const agencies = recordsOf(await runFixture(), "Agencies");
    expect(Object.keys(agencies).sort()).toEqual(["a2jALPHA", "a2jBETA"]);
    expect(agencies["a2jALPHA"].spec).toEqual({
      name: "Alpha Police Dept.",
      state: "MN",
      city: "Alphaville",
      address: "100 Main St",
      zip_code: "55111",
      contact_name: "Jane Chief",
      contact_email: "chief@alpha.mn",
    });
    // Not in the CSV -> MN fallback, null address fields.
    expect(agencies["a2jBETA"].spec).toEqual({
      name: "Beta County Sheriff",
      state: "MN",
      city: null,
      address: null,
      zip_code: null,
      contact_name: null,
      contact_email: null,
    });
    for (const record of Object.values(agencies)) {
      expect(AgencySpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("maps Personnel keyed by contactId, splitting names, importing disciplined officers and skipping only blank rows", async () => {
    const personnel = recordsOf(await runFixture(), "Personnel");
    // 0099 is disciplined but still imported; only the blank-contactId row is skipped.
    expect(Object.keys(personnel).sort()).toEqual(["0031", "0032", "0099"]);
    expect(personnel["0031"].spec).toEqual({
      id: "0031",
      first_name: "John",
      middle_name: "Robert",
      last_name: "Smith",
    });
    expect(personnel["0032"].spec).toMatchObject({
      first_name: "Mary",
      middle_name: null,
      last_name: "Jones",
    });
    for (const record of Object.values(personnel)) {
      expect(PersonnelSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("maps Licenses keyed by licenseId, issued by mn-post", async () => {
    const licenses = recordsOf(await runFixture(), "Licenses");
    expect(Object.keys(licenses).sort()).toEqual([
      "a2jLIC31",
      "a2jLIC32",
      "a2jLIC99",
    ]);
    expect(licenses["a2jLIC31"].spec).toEqual({
      officer_id: "0031",
      license_type: "Peace Officer",
      status: "Active",
      first_awarded: "2010-05-01",
      issued_by_authority_id: "mn-post",
    });
    for (const record of Object.values(licenses)) {
      expect(LicenseSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("maps one assignment per (officer, agency) with title=licenseType and license_id", async () => {
    const assignments = recordsOf(await runFixture(), "AgencyPersonnel");
    // Officer 0031 at both agencies -> two assignments; 0032 and the disciplined
    // 0099 at Alpha only.
    expect(Object.keys(assignments).sort()).toEqual([
      "0031|a2jALPHA",
      "0031|a2jBETA",
      "0032|a2jALPHA",
      "0099|a2jALPHA",
    ]);
    expect(assignments["0031|a2jBETA"].spec).toEqual({
      agency_id: "a2jBETA",
      officer_id: "0031",
      start_date: "2010-05-01",
      end_date: null,
      title: "Peace Officer",
      license_id: "a2jLIC31",
    });
    for (const record of Object.values(assignments)) {
      expect(AgencyPersonnelSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("emits a discipline event per order, with a coverage link and multi-agency attribution", async () => {
    const manifest = await runFixture();
    const discipline = recordsOf(manifest, "Disciplines");
    const attributions = recordsOf(manifest, "DisciplineAgencyOfficers");
    const coverage = recordsOf(manifest, "CoverageLinks");
    const coverageAttr = recordsOf(manifest, "CoverageLinkAgencyOfficers");

    // 0031 has one order; 0032's sentinel string yields nothing.
    expect(Object.keys(discipline)).toEqual(["0031|PB24-1-01"]);
    expect(discipline["0031|PB24-1-01"].spec).toEqual({
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: "2026-03-01",
      case_number: "PB24-1-01",
    });

    // 0031 is at both agencies → the order attributes to both assignments.
    expect(Object.keys(attributions).sort()).toEqual([
      "0031|PB24-1-01|a2jALPHA",
      "0031|PB24-1-01|a2jBETA",
    ]);
    expect(attributions["0031|PB24-1-01|a2jALPHA"].spec).toEqual({
      discipline_id: "0031|PB24-1-01",
      agency_officer_id: "0031|a2jALPHA",
    });

    expect(coverage["0031|PB24-1-01"].spec).toMatchObject({
      url: "https://example.mn/orders/PB24-1-01.pdf",
      title: "SACO PB24-1-01",
      source_name: "Minnesota POST",
      published_at: "2024-03-01",
    });
    expect(Object.keys(coverageAttr).sort()).toEqual([
      "0031|PB24-1-01|a2jALPHA",
      "0031|PB24-1-01|a2jBETA",
    ]);
    expect(coverageAttr["0031|PB24-1-01|a2jBETA"].spec).toMatchObject({
      coverage_link_id: "0031|PB24-1-01",
      agency_officer_id: "0031|a2jBETA",
      confidence: "documented",
    });

    for (const record of Object.values(discipline)) {
      expect(DisciplineSpec.safeParse(record.spec).success).toBe(true);
    }
    for (const record of Object.values(attributions)) {
      expect(DisciplineAgencyOfficerSpec.safeParse(record.spec).success).toBe(
        true,
      );
    }
    for (const record of Object.values(coverage)) {
      expect(CoverageLinkSpec.safeParse(record.spec).success).toBe(true);
    }
    for (const record of Object.values(coverageAttr)) {
      expect(CoverageLinkAgencyOfficerSpec.safeParse(record.spec).success).toBe(
        true,
      );
    }
  });
});
