import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { transform } from "../../sources/mn-post/transform.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
  LicensingAuthoritySpec,
  LicenseSpec,
  DisciplineSpec,
  PersonnelEducationSpec,
  CoverageLinkSpec,
} from "../../src/shared/io/index.js";
import {
  buildArtifactsEnvelope,
  type SourceManifest,
} from "../../src/cli/transform/source-transform.js";

// The mn-post source reads its inputs from files under the source folder (an
// `agency-ids.yaml` name→id map, an `agencies.csv` address list, and one raw
// `*.roster.json` officer list per agency), so the fixture writes those files to
// a temp dir and drives `transform()` with their paths. Two agencies: "Alpha Police
// Dept." (in the CSV, with an address) and "Beta County Sheriff" (absent from
// the CSV, so it falls back to state "MN" with no address). Officer 0031 works
// at both.
const agencyIds = [
  "Alpha Police Dept.:",
  "  id: a2jALPHA",
  "Beta County Sheriff:",
  "  id: a2jBETA",
].join("\n");

// Header matches the real MN POST roster export: the email column is
// "Organization Email", not "Email".
const agenciesCsv = [
  "Agency,Agency Type,Chief Law Enforcement Officer,Address,City,State,Zip,Phone,Organization Email",
  "Alpha Police Dept.,Police,Jane Chief,100 Main St,Alphaville,MN,55111,555-1000,chief@alpha.mn",
].join("\n");

// Rosters are the raw officer-list JSON the site returns (an array of officer
// rows) — written verbatim as `*.roster.json`, no transform.
const alphaRoster = JSON.stringify([
  {
    name: "Smith, John Robert",
    contactId: "0031",
    licenseId: "a2jLIC31",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2010-05-01",
    disciplinaryAction: false,
  },
  {
    name: "Jones, Mary",
    contactId: "0032",
    licenseId: "a2jLIC32",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2015-03-15",
    disciplinaryAction: false,
  },
  // disciplined -> still imported; discipline is never a reason to drop an officer
  {
    name: "Bad, Actor",
    contactId: "0099",
    licenseId: "a2jLIC99",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2012-01-01",
    disciplinaryAction: true,
  },
]);

const betaRoster = JSON.stringify([
  // same officer 0031, second agency -> one Personnel, a second assignment
  {
    name: "Smith, John Robert",
    contactId: "0031",
    licenseId: "a2jLIC31",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2010-05-01",
    disciplinaryAction: false,
  },
  // blank contactId -> skipped (no stable person id)
  {
    name: "No, Id",
    contactId: "",
    licenseId: "a2jLICXX",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2018-08-08",
    disciplinaryAction: false,
  },
]);

// Officer 0031's detail JSON carries a disciplinary order. 0031 is assigned to
// both agencies, but the order identifies only the person. 0032's detail has the no-discipline
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
  licenses: {
    POSTLicenseList: [
      {
        contactId: "0031",
        licenseId: "a2jLIC31",
        licenseType: "Peace Officer",
        status: "Active",
        originalLicenseIssueDate: "2010-05-01",
      },
      {
        contactId: "0031",
        licenseId: "a2jPT31",
        licenseType: "Part Time Peace Officer",
        status: "Cancelled",
        originalLicenseIssueDate: "2009-10-01",
      },
    ],
  },
  activeEmployment: [
    {
      rosterId: "a2m31ALPHA",
      agencyName: "Alpha Police Dept.",
      agencyStatus: "Primary",
    },
    {
      rosterId: "a2m31BETA",
      agencyName: "Beta County Sheriff",
      agencyStatus: "Secondary",
    },
  ],
});
const detail0032 = JSON.stringify({
  licenses: {
    POSTLicenseList: [
      {
        contactId: "0032",
        licenseId: "a2jLIC32",
        licenseType: "Peace Officer",
        status: "Active",
        originalLicenseIssueDate: "2015-03-15",
      },
    ],
  },
  activeEmployment: [
    { rosterId: "a2m32ALPHA", agencyName: "Alpha Police Dept." },
  ],
  disciplinaryActions: "No POST Disciplinary Actions found",
});
// 0099's order links to a document the site no longer serves, so acquire wrote
// no document record for it: its order fields stay null.
const detail0099 = JSON.stringify({
  licenses: {
    POSTLicenseList: [
      {
        contactId: "0099",
        licenseId: "a2jLIC99",
        licenseType: "Peace Officer",
        status: "Active",
        originalLicenseIssueDate: "2012-01-01",
      },
    ],
  },
  activeEmployment: [
    { rosterId: "a2m99ALPHA", agencyName: "Alpha Police Dept." },
  ],
  disciplinaryActions: [
    {
      contactId: "0099",
      caseNumber: "PB20-1-09",
      documentName: "SACO",
      documentURL: "https://example.mn/orders/PB20-1-09.pdf",
      effectiveDate: "2020-06-01",
      expirationDate: null,
    },
  ],
});

// The acquired record of what 0031's order document says (acquire's
// `documents/<stem>.document.json`), keyed by the action's document URL.
const document0031 = JSON.stringify({
  url: "https://example.mn/orders/PB24-1-01.pdf",
  documentName: "SACO",
  actions: [{ contactId: "0031", caseNumber: "PB24-1-01" }],
  sha256: "abc",
  bytes: 3,
  fetchedAt: "2026-09-10T12:00:00.000Z",
  pages: [{ page: 1, method: "ocr", text: "STIPULATION AND CONSENT ORDER" }],
  text: "STIPULATION AND CONSENT ORDER",
  analysis: {
    allegation: "engaging in sexual harassment",
    violation: "Minn. R. 6700.1600, subp. 1.A(4) (2023)",
    finding:
      "Smith engaged in sexual harassment as defined by Minn. Stat. § 363A.03",
    chief_action: "placed on unpaid leave for 6 days",
    sanction: "license REVOKED, stayed 6 years; SUSPENDED 25 days; CENSURED",
  },
  analyzedWith: { model: "test-model", promptVersion: 1 },
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
    path.join(sourceDir, "alpha-police-dept-000000000001.roster.json"),
    alphaRoster,
  );
  await writeFile(
    path.join(sourceDir, "beta-county-sheriff-000000000002.roster.json"),
    betaRoster,
  );
  await writeFile(
    path.join(sourceDir, "a2jofficer0031.detail.json"),
    detail0031,
  );
  await writeFile(
    path.join(sourceDir, "a2jofficer0032.detail.json"),
    detail0032,
  );
  await writeFile(
    path.join(sourceDir, "a2jofficer0099.detail.json"),
    detail0099,
  );
  await writeFile(
    path.join(sourceDir, "pb24-1-01-abcdef012345.document.json"),
    document0031,
  );
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function runFixture(): Promise<SourceManifest> {
  const files = await readdir(sourceDir);
  return transform({
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
      "AuthorityLicenses",
      "Agencies",
      "Personnel",
      "PersonnelEducations",
      "Licenses",
      "AgencyPersonnel",
      "Disciplines",
      "DisciplineAgencyPersonnel",
      "CoverageLinks",
      "CoverageLinkAgencyPersonnel",
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
    // Not in the CSV -> MN fallback; the resolved-location fields (city, address,
    // zip) are OMITTED, not null — a valid partial artifact whose location is
    // resolved from a CLI-managed cache value at import (required by the mutation).
    expect(agencies["a2jBETA"].spec).toEqual({
      name: "Beta County Sheriff",
      state: "MN",
      contact_name: null,
      contact_email: null,
    });
    for (const record of Object.values(agencies)) {
      expect(AgencySpec.safeParse(record.spec).success).toBe(true);
      // Primary/Secondary employment and license status are not agency status.
      expect(record.spec).not.toHaveProperty("status");
      expect(record.spec).not.toHaveProperty("status_date");
    }
  });

  it.each([
    ["551554047", "55155-4047", true],
    ["012345678", "01234-5678", true],
    ["55111", "55111", true],
    ["55155-4047", "55155-4047", true],
    ["55155404", "55155404", false],
    ["5515A4047", "5515A4047", false],
    ["000000000", "00000-0000", false],
  ])(
    "formats source ZIP %s as %s without dropping agency records",
    async (sourceZip, expectedZip, valid) => {
      const dir = await mkdtemp(path.join(tmpdir(), "mn-post-zip-"));
      try {
        const csvPath = path.join(dir, "agencies.csv");
        const csv = agenciesCsv.replace("55111", sourceZip);
        await writeFile(csvPath, csv);
        const paths = (await readdir(sourceDir))
          .filter((file) => file !== "agencies.csv")
          .map((file) => path.join(sourceDir, file));
        const manifest = await transform({
          paths: [...paths, csvPath],
          readXlsx: async () => [],
          state: "/unused",
          emit: async () => {},
        });

        expect(recordsOf(manifest, "Agencies")["a2jALPHA"].spec).toMatchObject({
          zip_code: expectedZip,
        });
        expect(Object.keys(recordsOf(manifest, "Agencies")).sort()).toEqual([
          "a2jALPHA",
          "a2jBETA",
        ]);
        expect(
          Object.keys(recordsOf(manifest, "AgencyPersonnel")).sort(),
        ).toEqual(["a2m31ALPHA", "a2m31BETA", "a2m32ALPHA", "a2m99ALPHA"]);
        const validate = () =>
          buildArtifactsEnvelope("mn-post", "zip-format", manifest);
        if (valid) {
          expect(validate).not.toThrow();
        } else {
          expect(validate).toThrow(/zip_code/);
        }
        expect(await readFile(csvPath, "utf8")).toBe(csv);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

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

  it("emits one AuthorityLicense per license type, issued by mn-post", async () => {
    const authorityLicenses = recordsOf(
      await runFixture(),
      "AuthorityLicenses",
    );
    expect(Object.keys(authorityLicenses).sort()).toEqual([
      "mn-post|Part Time Peace Officer",
      "mn-post|Peace Officer",
    ]);
    expect(authorityLicenses["mn-post|Part Time Peace Officer"].spec).toEqual({
      licensing_authority_id: "mn-post",
      name: "Part Time Peace Officer",
    });
    expect(authorityLicenses["mn-post|Peace Officer"].spec).toEqual({
      licensing_authority_id: "mn-post",
      name: "Peace Officer",
    });
  });

  it("maps Licenses (holdings) keyed by contactId|canonical-type", async () => {
    const licenses = recordsOf(await runFixture(), "Licenses");
    expect(Object.keys(licenses).sort()).toEqual([
      "0031|Part Time Peace Officer",
      "0031|Peace Officer",
      "0032|Peace Officer",
      "0099|Peace Officer",
    ]);
    expect(licenses["0031|Peace Officer"].spec).toEqual({
      personnel_id: "0031",
      authority_license_id: "mn-post|Peace Officer",
      status: "Active",
      first_awarded: "2010-05-01",
    });
    expect(licenses["0031|Part Time Peace Officer"].spec).toEqual({
      personnel_id: "0031",
      authority_license_id: "mn-post|Part Time Peace Officer",
      status: "Cancelled",
      first_awarded: "2009-10-01",
    });
    for (const record of Object.values(licenses)) {
      expect(LicenseSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("fails on conflicting person/type license records", async () => {
    const duplicate = path.join(sourceDir, "duplicate-license.detail.json");
    try {
      await writeFile(
        duplicate,
        JSON.stringify({
          licenses: {
            POSTLicenseList: [
              {
                contactId: "0031",
                licenseId: "another-source-id",
                licenseType: "Peace Officer",
                status: "Revoked",
                originalLicenseIssueDate: "2010-05-01",
              },
            ],
          },
        }),
      );

      await expect(runFixture()).rejects.toThrow(
        /conflicting license another-source-id for contact 0031, type Peace Officer/,
      );
    } finally {
      await rm(duplicate, { force: true });
    }
  });

  it("fails when a detail license references a person outside the included roster graph", async () => {
    const unknown = path.join(sourceDir, "unknown-license.detail.json");
    try {
      await writeFile(
        unknown,
        JSON.stringify({
          licenses: {
            POSTLicenseList: [
              {
                contactId: "9999",
                licenseId: "a2jLIC9999",
                licenseType: "Peace Officer",
                status: "Active",
                originalLicenseIssueDate: "2020-01-01",
              },
            ],
          },
        }),
      );

      await expect(runFixture()).rejects.toThrow(
        /license a2jLIC9999: unknown person contactId 9999/,
      );
    } finally {
      await rm(unknown, { force: true });
    }
  });

  it("preserves POST rosterIds as assignment source names and retains the assignment fields", async () => {
    const assignments = recordsOf(await runFixture(), "AgencyPersonnel");
    // Officer 0031 at both agencies -> two assignments; 0032 and the disciplined
    // 0099 at Alpha only.
    expect(Object.keys(assignments).sort()).toEqual([
      "a2m31ALPHA",
      "a2m31BETA",
      "a2m32ALPHA",
      "a2m99ALPHA",
    ]);
    expect(assignments["a2m31BETA"].spec).toEqual({
      agency_id: "a2jBETA",
      personnel_id: "0031",
      start_date: "2010-05-01",
      end_date: null,
      title: "Peace Officer",
      license_id: "0031|Peace Officer",
    });
    for (const record of Object.values(assignments)) {
      expect(record.spec).toHaveProperty("end_date", null);
      expect(AgencyPersonnelSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("preserves two distinct POST assignments without inferring order links", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-dual-"));
    try {
      const detail = JSON.parse(detail0031);
      detail.activeEmployment.push({
        rosterId: "a2m31SECONDARY",
        agencyName: "Alpha Police Dept.",
        agencyStatus: "Secondary",
      });
      const roster = JSON.parse(alphaRoster);
      roster.push({
        ...roster[0],
        licenseId: "a2jPT31",
        licenseType: "Part Time Peace Officer",
        status: "Cancelled",
        originalLicenseIssueDate: "2009-10-01",
      });
      const rosterFile = path.join(
        dir,
        "alpha-police-dept-000000000001.roster.json",
      );
      await writeFile(rosterFile, JSON.stringify(roster));
      const file = path.join(dir, "duplicate.detail.json");
      await writeFile(file, JSON.stringify(detail));
      const paths = (await readdir(sourceDir))
        .filter(
          (f) =>
            f !== "a2jofficer0031.detail.json" &&
            !f.startsWith("alpha-police-dept"),
        )
        .map((f) => path.join(sourceDir, f));
      const result = await transform({
        paths: [...paths, file, rosterFile],
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      });
      expect(
        Object.values(recordsOf(result, "Licenses")).filter(
          (row) => LicenseSpec.parse(row.spec).personnel_id === "0031",
        ),
      ).toHaveLength(2);
      expect(
        recordsOf(result, "Disciplines")["0031|PB24-1-01"].spec,
      ).toMatchObject({
        personnel_id: "0031",
        licensing_authority_id: "mn-post",
      });
      const assignments = recordsOf(result, "AgencyPersonnel");
      expect(assignments.a2m31ALPHA.spec).toEqual(
        assignments.a2m31SECONDARY.spec,
      );
      for (const kind of [
        "DisciplineAgencyPersonnel",
        "CoverageLinkAgencyPersonnel",
      ]) {
        expect(recordsOf(result, kind)).toEqual({});
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails with the contact and agency when POST assignment identity is missing", async () => {
    const paths = (await readdir(sourceDir))
      .filter((f) => f !== "a2jofficer0032.detail.json")
      .map((f) => path.join(sourceDir, f));
    await expect(
      transform({
        paths,
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      }),
    ).rejects.toThrow(/0032.*Alpha Police Dept/);
  });

  it("emits person and issuer discipline with stable coverage links", async () => {
    const manifest = await runFixture();
    const discipline = recordsOf(manifest, "Disciplines");
    const attributions = recordsOf(manifest, "DisciplineAgencyPersonnel");
    const coverage = recordsOf(manifest, "CoverageLinks");
    const coverageAttr = recordsOf(manifest, "CoverageLinkAgencyPersonnel");

    // 0031 and 0099 have one order each; 0032's sentinel string yields nothing.
    expect(Object.keys(discipline).sort()).toEqual([
      "0031|PB24-1-01",
      "0099|PB20-1-09",
    ]);
    // 0031's order document was acquired and analyzed: its fields come through.
    expect(discipline["0031|PB24-1-01"].spec).toEqual({
      personnel_id: "0031",
      licensing_authority_id: "mn-post",
      document_url: "https://example.mn/orders/PB24-1-01.pdf",
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: "2026-03-01",
      case_number: "PB24-1-01",
      allegation: "engaging in sexual harassment",
      violation: "Minn. R. 6700.1600, subp. 1.A(4) (2023)",
      finding:
        "Smith engaged in sexual harassment as defined by Minn. Stat. § 363A.03",
      chief_action: "placed on unpaid leave for 6 days",
      sanction: "license REVOKED, stayed 6 years; SUSPENDED 25 days; CENSURED",
    });
    // 0099's document is unavailable (no document record): order fields null.
    expect(discipline["0099|PB20-1-09"].spec).toEqual({
      personnel_id: "0099",
      licensing_authority_id: "mn-post",
      document_url: "https://example.mn/orders/PB20-1-09.pdf",
      action: "SACO",
      effective_date: "2020-06-01",
      expiration_date: null,
      case_number: "PB20-1-09",
      allegation: null,
      violation: null,
      finding: null,
      chief_action: null,
      sanction: null,
    });

    expect(attributions).toEqual({});

    expect(coverage["0031|PB24-1-01"].spec).toMatchObject({
      url: "https://example.mn/orders/PB24-1-01.pdf",
      title: "SACO PB24-1-01",
      source_name: "Minnesota POST",
      published_at: "2024-03-01",
    });
    expect(coverageAttr).toEqual({});

    for (const record of Object.values(discipline)) {
      expect(DisciplineSpec.safeParse(record.spec).success).toBe(true);
    }
    for (const record of Object.values(coverage)) {
      expect(CoverageLinkSpec.safeParse(record.spec).success).toBe(true);
    }
  });
});

describe("mn-post run — unmapped agencies", () => {
  async function runWith(
    files: Record<string, string>,
  ): Promise<SourceManifest> {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-unmapped-"));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(dir, name), content);
    }
    const paths = Object.keys(files).map((f) => path.join(dir, f));
    try {
      return await transform({
        paths,
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const idMap = "Alpha Police Dept.:\n  id: a2jALPHA\n";

  it("skips an empty roster whose agency is absent from agency-ids.yaml", async () => {
    const manifest = await runWith({
      "agency-ids.yaml": idMap,
      "howard-lake-police-dept-000000000001.roster.json": "[]",
    });
    const agencies = manifest.artifacts.find(
      (a) => a.kind === "Agencies",
    )!.records;
    expect(Object.keys(agencies)).toEqual([]);
  });

  it("throws when a non-empty roster's agency is absent from agency-ids.yaml", async () => {
    await expect(
      runWith({
        "agency-ids.yaml": idMap,
        "ghost-police-dept-000000000002.roster.json": JSON.stringify([
          {
            contactId: "0001",
            licenseId: "lic1",
            name: "Doe, Jane",
            licenseType: "Peace Officer",
            originalLicenseIssueDate: "2020-01-01",
          },
        ]),
      }),
    ).rejects.toThrow(/has no agency in agency-ids.yaml/);
  });
});

describe("mn-post personnel details", () => {
  const course = {
    courseId: "course-1",
    contactId: "0031",
    name: "Training",
    endDate: "2026-08-16",
    credits: 1,
    sponsorname: "Sponsor",
    sponsorInstructor: null,
  };
  const action = JSON.parse(detail0031).disciplinaryActions[0];
  async function runDetails(
    detail: unknown,
    documents: unknown[] = [],
    roster = [{ contactId: "0031", name: "Smith, John" }],
    messages: string[] = [],
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-details-"));
    const files: Record<string, string> = {
      "agency-ids.yaml": agencyIds,
      "alpha-police-dept-000000000001.roster.json": JSON.stringify(roster),
      "person.detail.json": JSON.stringify(detail),
      ...Object.fromEntries(
        documents.map((doc, i) => [`${i}.document.json`, JSON.stringify(doc)]),
      ),
    };
    try {
      for (const [name, contents] of Object.entries(files))
        await writeFile(path.join(dir, name), contents);
      const result = await transform({
        paths: Object.keys(files).map((name) => path.join(dir, name)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
        logger: { info: (message) => messages.push(message) },
      });
      for (const [name, contents] of Object.entries(files))
        expect(await readFile(path.join(dir, name), "utf8")).toBe(contents);
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("emits discipline without a license or assignment", async () => {
    const result = await runDetails({ disciplinaryActions: [action] });
    expect(
      recordsOf(result, "Disciplines")["0031|PB24-1-01"].spec,
    ).toMatchObject({
      personnel_id: "0031",
      licensing_authority_id: "mn-post",
      document_url: action.documentURL,
    });
    expect(recordsOf(result, "DisciplineAgencyPersonnel")).toEqual({});
    expect(recordsOf(result, "CoverageLinkAgencyPersonnel")).toEqual({});
  });
  it.each([
    { contactId: null },
    { contactId: "unknown" },
    { caseNumber: null },
  ])("rejects missing or unknown discipline identity %j", async (patch) => {
    await expect(
      runDetails({ disciplinaryActions: [{ ...action, ...patch }] }),
    ).rejects.toThrow(/discipline.*(contact|case|person)/i);
  });
  it("maps education source fields and preserves nulls", async () => {
    const result = await runDetails({
      education: [
        course,
        {
          ...course,
          courseId: "course-2",
          endDate: null,
          credits: null,
          sponsorname: null,
        },
      ],
    });
    const rows = recordsOf(result, "PersonnelEducations");
    expect(rows["course-1"].spec).toEqual({
      personnel_id: "0031",
      name: "Training",
      completion_date: "2026-08-16",
      credits: 1,
      sponsor_name: "Sponsor",
      sponsor_instructor: null,
    });
    expect(rows["course-2"].spec).toEqual({
      personnel_id: "0031",
      name: "Training",
      completion_date: null,
      credits: null,
      sponsor_name: null,
      sponsor_instructor: null,
    });
    for (const row of Object.values(rows))
      expect(PersonnelEducationSpec.safeParse(row.spec).success).toBe(true);
  });
  it.each([{ courseId: null }, { contactId: null }, { contactId: "unknown" }])(
    "rejects missing or unknown education identity before omitting unnamed rows %j",
    async (patch) => {
      await expect(
        runDetails({ education: [{ ...course, name: null, ...patch }] }),
      ).rejects.toThrow(/education.*(course|contact|person)/i);
    },
  );
  it("reports each of three unnamed completions and retains the named completion", async () => {
    const messages: string[] = [];
    const result = await runDetails(
      {
        education: [
          course,
          ...[null, "", "  "].map((name, i) => ({
            ...course,
            courseId: `unnamed-${i}`,
            name,
          })),
        ],
      },
      [],
      undefined,
      messages,
    );
    expect(Object.keys(recordsOf(result, "PersonnelEducations"))).toEqual([
      "course-1",
    ]);
    expect(messages).toHaveLength(3);
    for (let i = 0; i < 3; i++)
      expect(messages[i]).toMatch(new RegExp(`unnamed-${i}.*name`));
  });
  it("coalesces identical education and rejects conflicting course IDs", async () => {
    expect(
      Object.keys(
        recordsOf(
          await runDetails({ education: [course, course] }),
          "PersonnelEducations",
        ),
      ),
    ).toEqual(["course-1"]);
    await expect(
      runDetails({ education: [course, { ...course, credits: 2 }] }),
    ).rejects.toThrow(/conflict.*course-1/i);
  });
  it.each(["documentName", "effectiveDate", "expirationDate"])(
    "rejects duplicate case disagreement in %s",
    async (field) => {
      await expect(
        runDetails({
          disciplinaryActions: [
            action,
            {
              ...action,
              [field]: field === "documentName" ? "Revocation" : "2026-01-02",
            },
          ],
        }),
      ).rejects.toThrow(/conflict.*0031\|PB24-1-01/i);
    },
  );
  it("coalesces duplicate case documents that agree, preserving the existing last-entry coverage URL", async () => {
    const doc = JSON.parse(document0031);
    const second = {
      ...action,
      documentURL: "https://example.mn/duplicate.pdf",
    };
    const result = await runDetails({ disciplinaryActions: [action, second] }, [
      doc,
      { ...doc, url: second.documentURL },
    ]);
    expect(Object.keys(recordsOf(result, "Disciplines"))).toEqual([
      "0031|PB24-1-01",
    ]);
    expect(
      recordsOf(result, "CoverageLinks")["0031|PB24-1-01"].spec,
    ).toMatchObject({ url: second.documentURL });
  });
  it.each(["sha256", "analysis"])(
    "rejects conflicting available document %s for a duplicate case",
    async (field) => {
      const doc = JSON.parse(document0031);
      const second = {
        ...action,
        documentURL: "https://example.mn/duplicate.pdf",
      };
      const changed =
        field === "sha256"
          ? "different"
          : { ...doc.analysis, sanction: "different" };
      await expect(
        runDetails({ disciplinaryActions: [action, second] }, [
          doc,
          { ...doc, url: second.documentURL, [field]: changed },
        ]),
      ).rejects.toThrow(/conflict.*0031\|PB24-1-01/i);
    },
  );
  it("names the case when document records for the same URL conflict", async () => {
    const doc = JSON.parse(document0031);
    await expect(
      runDetails({ disciplinaryActions: [action] }, [
        doc,
        { ...doc, sha256: "different" },
      ]),
    ).rejects.toThrow(/conflict.*0031\|PB24-1-01/i);
  });
  it("keeps unavailable last-entry document fields null without changing its URL", async () => {
    const doc = JSON.parse(document0031);
    const second = {
      ...action,
      documentURL: "https://example.mn/unavailable.pdf",
    };
    const result = await runDetails({ disciplinaryActions: [action, second] }, [
      doc,
    ]);
    expect(
      recordsOf(result, "Disciplines")["0031|PB24-1-01"].spec,
    ).toMatchObject({
      document_url: second.documentURL,
      allegation: null,
      violation: null,
      finding: null,
      chief_action: null,
      sanction: null,
    });
    expect(
      recordsOf(result, "CoverageLinks")["0031|PB24-1-01"].spec,
    ).toMatchObject({ url: second.documentURL });
  });
  it("emits empty education for empty source arrays", async () => {
    expect(
      recordsOf(
        await runDetails({ education: [], disciplinaryActions: [] }),
        "PersonnelEducations",
      ),
    ).toEqual({});
  });
});
