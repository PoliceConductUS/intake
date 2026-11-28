import { ORDER_ANALYSIS_PROMPT_SHA256 } from "../../../../../../../sources/com/site/my/mnitservices/post-license-search/acquire/order-prompt.js";
import { createHash } from "node:crypto";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { documentStem } from "../../../../../../../sources/com/site/my/mnitservices/post-license-search/acquire/collect-documents.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactStem } from "../../../../../../../sources/com/site/my/mnitservices/post-license-search/acquire/collect.js";
import { transform } from "../../../../../../../sources/com/site/my/mnitservices/post-license-search/transform.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
  LicensingAuthoritySpec,
  LicenseSpec,
  DisciplineSpec,
  PersonnelEducationSpec,
  CoverageLinkSpec,
} from "../../../../../../../src/shared/io/index.js";
import {
  buildArtifactsEnvelope,
  type SourceManifest,
} from "../../../../../../../src/cli/transform/source-transform.js";

// The com/site/my/mnitservices/post-license-search source reads its inputs from files under the source folder (an
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
      complaintId: "complaint99",
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
  sha256: createHash("sha256").update("pdf").digest("hex"),
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
  absenceReasons: {},
  analyzedWith: {
    model: "test-model",
    promptSha256: ORDER_ANALYSIS_PROMPT_SHA256,
  },
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
  await writeFile(path.join(sourceDir, "pb24-1-01-abcdef012345.pdf"), "pdf");
  await writeFile(
    path.join(sourceDir, "skipped.yaml"),
    stringifyYaml({
      skippedAgencies: [],
      skippedOfficers: [],
      skippedDocuments: [
        {
          url: JSON.parse(detail0099).disciplinaryActions[0].documentURL,
          actions: [{ contactId: "0099", caseNumber: "PB20-1-09" }],
          reason: "source returned 404",
        },
      ],
    }),
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

function accountingOf(manifest: SourceManifest, input: string) {
  return manifest.accounting.find((entry) => entry.input === input);
}

describe("com/site/my/mnitservices/post-license-search document completion", () => {
  it.each(["matching", "analysis conflict", "PDF conflict"])(
    "checks retained same-URL evidence (%s) when an earlier case is acquired",
    async (mode) => {
      const dir = await mkdtemp(path.join(tmpdir(), "mn-earlier-case-"));
      try {
        await mkdir(path.join(dir, "officers"));
        const files = {
          "agency-ids.yaml": agencyIds,
          "agencies.csv": agenciesCsv,
          "alpha-police-dept-000000000001.roster.json": JSON.stringify(
            JSON.parse(alphaRoster).filter(
              (p: { contactId: string }) => p.contactId === "0031",
            ),
          ),
          "beta-county-sheriff-000000000002.roster.json": JSON.stringify(
            JSON.parse(betaRoster).filter(
              (p: { contactId: string }) => p.contactId === "0031",
            ),
          ),
        };
        for (const [name, value] of Object.entries(files))
          await writeFile(path.join(dir, name), value);
        const old = JSON.parse(detail0031);
        old.disciplinaryActions[0].caseNumber = "OLD";
        await writeFile(
          path.join(dir, "officers", "z.detail.json"),
          JSON.stringify(old),
        );
        const { collectDocuments } =
          await import("../../../../../../../sources/com/site/my/mnitservices/post-license-search/acquire/collect-documents.js");
        const deps = {
          sourceDir: dir,
          statePath: path.join(dir, "cache"),
          fetchDocument: async () => ({
            kind: "pdf" as const,
            bytes: Buffer.from("pdf"),
          }),
          extractText: async () => ({
            pages: [{ page: 1, method: "text" as const, text: "order" }],
          }),
          analyzer: {
            model: "test",
            promptSha256: ORDER_ANALYSIS_PROMPT_SHA256,
            analyze: async () => ({
              analysis: {
                allegation: null,
                violation: null,
                finding: null,
                chief_action: null,
                sanction: null,
              },
              absenceReasons: {
                allegation: "The fixture order states no factual basis.",
                violation: "The fixture order cites no violation.",
                finding: "The fixture order states no findings.",
                chief_action:
                  "The fixture order describes no employer response.",
                sanction: "The fixture order states no sanction.",
              },
            }),
          },
          now: () => "2026-10-18",
        };
        await collectDocuments(deps);
        const newer = JSON.parse(detail0031);
        newer.disciplinaryActions[0].caseNumber = "NEW";
        newer.disciplinaryActions[0].complaintId = "new-complaint";
        await writeFile(
          path.join(dir, "officers", "a.detail.json"),
          JSON.stringify(newer),
        );
        await collectDocuments(deps);
        if (mode !== "matching") {
          const documentsDir = path.join(dir, "documents");
          const name = (await readdir(documentsDir)).find(
            (name) =>
              name.startsWith("old-") && name.endsWith(".document.json"),
          )!;
          const doc = JSON.parse(
            await readFile(path.join(documentsDir, name), "utf8"),
          );
          if (mode === "analysis conflict") {
            doc.analysis.sanction = "Different sanction";
            delete doc.absenceReasons.sanction;
          } else {
            const bytes = Buffer.from("different PDF");
            await writeFile(
              path.join(documentsDir, name.replace(".document.json", ".pdf")),
              bytes,
            );
            doc.sha256 = createHash("sha256").update(bytes).digest("hex");
            doc.bytes = bytes.length;
          }
          await writeFile(path.join(documentsDir, name), JSON.stringify(doc));
        }
        const { sourceInputPaths } =
          await import("../../../../../../../src/cli/transform/index.js");
        const pending = transform({
          paths: await sourceInputPaths(dir),
          readXlsx: async () => [],
          state: "/unused",
          emit: async () => {},
        });
        if (mode !== "matching") {
          await expect(pending).rejects.toThrow(
            /conflicting document evidence/,
          );
          return;
        }
        const result = await pending;
        expect(Object.keys(recordsOf(result, "Disciplines"))).toEqual([
          "0031|new-complaint",
          "0031|cmp-001",
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  async function runDocumentFixture(
    change: (files: Record<string, string>) => void,
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-document-contract-"));
    try {
      const files: Record<string, string> = Object.fromEntries(
        await Promise.all(
          (await readdir(sourceDir)).map(async (name) => [
            name,
            await readFile(path.join(sourceDir, name), "utf8"),
          ]),
        ),
      );
      change(files);
      for (const [name, value] of Object.entries(files))
        await writeFile(path.join(dir, name), value);
      return await transform({
        paths: Object.keys(files).map((n) => path.join(dir, n)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  it.each(["missing analysis", "invalid analysis", "mismatched PDF"])(
    "rejects %s",
    async (mode) => {
      await expect(
        runDocumentFixture((files) => {
          const name = "pb24-1-01-abcdef012345.document.json";
          const doc = JSON.parse(files[name]);
          if (mode === "missing analysis") delete doc.analysis;
          else if (mode === "invalid analysis") doc.analysis.sanction = 42;
          else files["pb24-1-01-abcdef012345.pdf"] = "changed";
          files[name] = JSON.stringify(doc);
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects a stale unavailable report when its PDF remains unfinished", async () => {
    await expect(
      runDocumentFixture((files) => {
        delete files["pb24-1-01-abcdef012345.document.json"];
        const action = JSON.parse(detail0031).disciplinaryActions[0];
        const reference = {
          url: action.documentURL,
          documentName: action.documentName,
          actions: [
            { contactId: action.contactId, caseNumber: action.caseNumber },
          ],
        };
        files[documentStem(reference) + ".pdf"] = "pdf";
        const skipped = parseYaml(files["skipped.yaml"]);
        skipped.skippedDocuments.push({ ...reference, reason: "404" });
        delete skipped.skippedDocuments.at(-1).documentName;
        files["skipped.yaml"] = stringifyYaml(skipped);
      }),
    ).rejects.toThrow(/document incomplete.*PB24-1-01/);
  });
  it("rejects unavailable results for another action", async () => {
    await expect(
      runDocumentFixture((files) => {
        delete files["pb24-1-01-abcdef012345.document.json"];
        const skipped = parseYaml(files["skipped.yaml"]);
        skipped.skippedDocuments.push({
          url: JSON.parse(detail0031).disciplinaryActions[0].documentURL,
          actions: [{ contactId: "other", caseNumber: "PB24-1-01" }],
          reason: "404",
        });
        files["skipped.yaml"] = stringifyYaml(skipped);
      }),
    ).rejects.toThrow(/document incomplete.*PB24-1-01/);
  });
});

describe("com/site/my/mnitservices/post-license-search run", () => {
  it("rejects referenced documents without completed analysis or an unavailable result", async () => {
    const paths = (await readdir(sourceDir))
      .filter((f) => !f.endsWith(".document.json"))
      .map((f) => path.join(sourceDir, f));
    await expect(
      transform({
        paths,
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      }),
    ).rejects.toThrow(/document.*PB24-1-01/i);
  });
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
      "CoverageLinks",
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
          buildArtifactsEnvelope(
            "com/site/my/mnitservices/post-license-search",
            "zip-format",
            manifest,
          );
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

  it("maps Personnel keyed by contactId, splitting names and importing disciplined officers", async () => {
    const personnel = recordsOf(await runFixture(), "Personnel");
    // 0099 is disciplined but still imported.
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

  it("emits one AuthorityLicense per license type, issued by com/site/my/mnitservices/post-license-search", async () => {
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
        recordsOf(result, "Disciplines")["0031|cmp-001"].spec,
      ).toMatchObject({
        personnel_id: "0031",
        licensing_authority_id: "mn-post",
      });
      const assignments = recordsOf(result, "AgencyPersonnel");
      expect(assignments.a2m31ALPHA.spec).toEqual(
        assignments.a2m31SECONDARY.spec,
      );
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
    const coverage = recordsOf(manifest, "CoverageLinks");

    // 0031 and 0099 have one order each; 0032's sentinel string yields nothing.
    expect(Object.keys(discipline).sort()).toEqual([
      "0031|cmp-001",
      "0099|complaint99",
    ]);
    // 0031's order document was acquired and analyzed: its fields come through.
    expect(discipline["0031|cmp-001"].spec).toEqual({
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
    // 0099's document is unavailable: absent analysis does not clear stored fields.
    expect(discipline["0099|complaint99"].spec).toEqual({
      personnel_id: "0099",
      licensing_authority_id: "mn-post",
      document_url: "https://example.mn/orders/PB20-1-09.pdf",
      action: "SACO",
      effective_date: "2020-06-01",
      expiration_date: null,
      case_number: "PB20-1-09",
    });

    expect(coverage["0031|cmp-001"].spec).toMatchObject({
      url: "https://example.mn/orders/PB24-1-01.pdf",
      title: "SACO PB24-1-01",
      source_name: "Minnesota POST",
      published_at: "2024-03-01",
    });
    for (const record of Object.values(discipline)) {
      expect(DisciplineSpec.safeParse(record.spec).success).toBe(true);
    }
    for (const record of Object.values(coverage)) {
      expect(CoverageLinkSpec.safeParse(record.spec).success).toBe(true);
    }
  });
});

describe("com/site/my/mnitservices/post-license-search run — unmapped agencies", () => {
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

describe("com/site/my/mnitservices/post-license-search personnel details", () => {
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
    roster: unknown[] = [
      { contactId: "0031", licenseId: "a2jLIC31", name: "Smith, John" },
    ],
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-details-"));
    const files: Record<string, string> = {
      "agency-ids.yaml": agencyIds,
      "alpha-police-dept-000000000001.roster.json": JSON.stringify(roster),
      "person.detail.json": JSON.stringify(detail),
      ...Object.fromEntries(
        documents.map((raw, i) => {
          const doc = raw as { analysis: Record<string, unknown> };
          return [
            `${i}.document.json`,
            JSON.stringify({
              ...doc,
              absenceReasons: Object.fromEntries(
                Object.entries(doc.analysis)
                  .filter(([, value]) => value === null)
                  .map(([field]) => [
                    field,
                    `The fixture order heading does not state ${field}.`,
                  ]),
              ),
            }),
          ];
        }),
      ),
      ...Object.fromEntries(documents.map((doc, i) => [`${i}.pdf`, "pdf"])),
      "skipped.yaml": stringifyYaml({
        skippedAgencies: [],
        skippedOfficers: [],
        skippedDocuments: ((detail as { disciplinaryActions?: unknown })
          .disciplinaryActions instanceof Array
          ? (detail as { disciplinaryActions: Record<string, string>[] })
              .disciplinaryActions
          : []
        )
          .filter(
            (a) =>
              a.documentURL &&
              a.contactId &&
              a.caseNumber &&
              !documents.some(
                (d) => (d as { url: string }).url === a.documentURL,
              ),
          )
          .map((a) => ({
            url: a.documentURL,
            actions: [{ contactId: a.contactId, caseNumber: a.caseNumber }],
            reason: "source returned 404",
          })),
      }),
    };
    try {
      for (const [name, contents] of Object.entries(files))
        await writeFile(path.join(dir, name), contents);
      const result = await transform({
        paths: Object.keys(files).map((name) => path.join(dir, name)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
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
    expect(recordsOf(result, "Disciplines")["0031|cmp-001"].spec).toMatchObject(
      {
        personnel_id: "0031",
        licensing_authority_id: "mn-post",
        document_url: action.documentURL,
      },
    );
  });
  it.each([
    { contactId: null },
    { contactId: "unknown" },
    { caseNumber: null },
    { complaintId: null },
  ])("rejects missing or unknown discipline identity %j", async (patch) => {
    await expect(
      runDetails({ disciplinaryActions: [{ ...action, ...patch }] }),
    ).rejects.toThrow(/discipline.*(contact|case|person|complaint)/i);
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
  it("reports each of three unnamed completions on the officer's record and retains the named completion", async () => {
    const result = await runDetails({
      education: [
        course,
        ...[null, "", "  "].map((name, i) => ({
          ...course,
          courseId: `unnamed-${i}`,
          name,
        })),
      ],
    });
    expect(Object.keys(recordsOf(result, "PersonnelEducations"))).toEqual([
      "course-1",
    ]);
    expect(recordsOf(result, "Personnel")["0031"].metadata?.defects).toEqual(
      [null, "", "  "].map((name, i) => ({
        code: "education-course-without-name",
        type: "warning",
        field: "name",
        value: name,
        message:
          "A completed training course was left out because the state's record gives no course name.",
        evidence: [{ file: "person.detail.json", courseId: `unnamed-${i}` }],
        source_namespace: "com/site/my/mnitservices/post-license-search",
        source_record_id: `unnamed-${i}`,
      })),
    );
    expect(accountingOf(result, "detail.json education")).toEqual({
      input: "detail.json education",
      read: 4,
      emitted: 1,
      reported: 3,
      notSelected: {},
    });
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
  it.each(["documentName", "effectiveDate", "expirationDate", "caseNumber"])(
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
      ).rejects.toThrow(/conflict.*0031\|cmp-001|sha256|document actions/i);
    },
  );
  it("preserves distinct official complaints that reuse the same visible case label", async () => {
    const result = await runDetails({
      disciplinaryActions: [
        action,
        {
          ...action,
          complaintId: "complaint-second",
          effectiveDate: "2014-04-24",
        },
      ],
    });
    const rows = recordsOf(result, "Disciplines");
    expect(Object.keys(rows).sort()).toEqual([
      "0031|cmp-001",
      "0031|complaint-second",
    ]);
    expect(rows["0031|complaint-second"].spec).toMatchObject({
      case_number: "PB24-1-01",
      effective_date: "2014-04-24",
    });
    expect(rows["0031|cmp-001"].spec).toMatchObject({
      case_number: "PB24-1-01",
      effective_date: "2024-03-01",
    });
    expect(Object.keys(recordsOf(result, "CoverageLinks")).sort()).toEqual([
      "0031|cmp-001",
      "0031|complaint-second",
    ]);
  });
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
      "0031|cmp-001",
    ]);
    expect(
      recordsOf(result, "CoverageLinks")["0031|cmp-001"].spec,
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
      ).rejects.toThrow(/conflict.*0031\|cmp-001|sha256|document actions/i);
    },
  );
  it("names the case when document records for the same URL conflict", async () => {
    const doc = JSON.parse(document0031);
    await expect(
      runDetails({ disciplinaryActions: [action] }, [
        doc,
        { ...doc, sha256: "different" },
      ]),
    ).rejects.toThrow(/conflict.*0031\|cmp-001|sha256|document actions/i);
  });
  it("omits unavailable last-entry analysis fields without changing its URL", async () => {
    const doc = JSON.parse(document0031);
    const second = {
      ...action,
      documentURL: "https://example.mn/unavailable.pdf",
    };
    const result = await runDetails({ disciplinaryActions: [action, second] }, [
      doc,
    ]);
    expect(recordsOf(result, "Disciplines")["0031|cmp-001"].spec).toMatchObject(
      {
        document_url: second.documentURL,
      },
    );
    for (const field of [
      "allegation",
      "violation",
      "finding",
      "chief_action",
      "sanction",
    ]) {
      expect(
        Object.hasOwn(
          recordsOf(result, "Disciplines")["0031|cmp-001"].spec as object,
          field,
        ),
      ).toBe(false);
    }
    expect(
      recordsOf(result, "CoverageLinks")["0031|cmp-001"].spec,
    ).toMatchObject({ url: second.documentURL });
  });
  it("preserves explicit nulls in a supplied order analysis", async () => {
    const doc = JSON.parse(document0031);
    const analysis = {
      allegation: null,
      violation: null,
      finding: null,
      chief_action: null,
      sanction: null,
    };
    const result = await runDetails({ disciplinaryActions: [action] }, [
      { ...doc, analysis },
    ]);
    expect(recordsOf(result, "Disciplines")["0031|cmp-001"].spec).toMatchObject(
      analysis,
    );
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

describe("com/site/my/mnitservices/post-license-search discipline workbook personnel", () => {
  const officer = {
    contactId: "revoked-person",
    licenseId: "revoked-license",
    licenseNumber: "12345",
    name: "Smith, John Robert",
    licenseType: "Peace Officer",
    status: "Revoked",
    originalLicenseIssueDate: "1990-01-01",
  };
  const history = {
    sourceRow: 2,
    agencyName: "Alpha Police Dept.",
    startDate: "1995-02-03",
    endDate: "2001-04-05",
  };
  const person = {
    licenseNumber: "12345",
    sourceRow: 2,
    name: officer.name,
    officer,
    history: [] as (typeof history)[],
  };
  async function runPeople(
    people = [person],
    roster?: unknown[],
    actions = people.map((p) => ({
      contactId: p.officer.contactId,
      caseNumber: "PB-1",
      complaintId: "complaint1",
      documentName: "Revocation",
      effectiveDate: "2001-04-05",
    })),
    unresolvedAgencies?: Array<{
      agencyName: string;
      reason: string;
      kind: string;
      candidateCount: number;
    }>,
    extra: { missingActions?: unknown[]; unresolvedLicenses?: unknown[] } = {},
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-standalone-"));
    const files: Record<string, string> = {
      "agency-ids.yaml": agencyIds,
      "discipline-personnel.json": JSON.stringify({
        people,
        missingActions: extra.missingActions ?? [],
      }),
      "discipline-unresolved-licenses.json": JSON.stringify(
        extra.unresolvedLicenses ?? [],
      ),
      "person.detail.json": JSON.stringify({
        licenses: { POSTLicenseList: people.map((p) => p.officer) },
        disciplinaryActions: actions,
      }),
    };
    if (roster) files["alpha-police-dept.roster.json"] = JSON.stringify(roster);
    if (
      roster ||
      people.some((p) =>
        p.history.some((row) => row.agencyName === "Alpha Police Dept."),
      )
    )
      files["agencies.csv"] = agenciesCsv;
    if (unresolvedAgencies !== undefined)
      files["discipline-unresolved-agencies.json"] =
        JSON.stringify(unresolvedAgencies);
    try {
      for (const [name, content] of Object.entries(files))
        await writeFile(path.join(dir, name), content);
      return await transform({
        paths: Object.keys(files).map((name) => path.join(dir, name)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      }).then(async (result) => {
        for (const [name, content] of Object.entries(files))
          expect(await readFile(path.join(dir, name), "utf8")).toBe(content);
        return result;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  it("declares only workbook personnel even when no action details are returned", async () => {
    const result = await runPeople(
      [person],
      [
        {
          contactId: "unrelated-roster-person",
          licenseId: "unrelated-license",
          name: "Someone, Else",
        },
      ],
      [],
    );
    expect(Object.keys(recordsOf(result, "Personnel"))).toHaveLength(2);
    expect(result.personnelSourceNames).toEqual(["revoked-person"]);
    expect(recordsOf(result, "Disciplines")).toEqual({});
  });
  it("imports a revoked person and actual discipline without any agency roster or assignment", async () => {
    const result = await runPeople();
    expect(
      recordsOf(result, "Personnel")[officer.contactId].spec,
    ).toMatchObject({ first_name: "John", last_name: "Smith" });
    expect(
      recordsOf(result, "Licenses")[`${officer.contactId}|Peace Officer`].spec,
    ).toMatchObject({ status: "Revoked" });
    expect(
      recordsOf(result, "Disciplines")[`${officer.contactId}|complaint1`].spec,
    ).toMatchObject({ personnel_id: officer.contactId });
    expect(recordsOf(result, "AgencyPersonnel")).toEqual({});
    expect(recordsOf(result, "Agencies")).toEqual({});
  });
  it("reuses an existing roster contact without merging a different contact with the same name", async () => {
    const second = {
      ...person,
      licenseNumber: "54321",
      officer: {
        ...officer,
        contactId: "second-person",
        licenseId: "second-license",
        licenseNumber: "54321",
      },
    };
    const result = await runPeople(
      [person, second],
      [
        {
          contactId: officer.contactId,
          licenseId: officer.licenseId,
          name: officer.name,
        },
      ],
    );
    expect(Object.keys(recordsOf(result, "Personnel")).sort()).toEqual([
      "revoked-person",
      "second-person",
    ]);
    expect(result.personnelSourceNames).toEqual([
      "revoked-person",
      "second-person",
    ]);
    expect(
      buildArtifactsEnvelope(
        "com/site/my/mnitservices/post-license-search",
        "roots",
        result,
      ).spec.personnelSourceNames,
    ).toEqual(result.personnelSourceNames);
  });
  it("rejects conflicting person content for an existing contact", async () => {
    await expect(
      runPeople(
        [person],
        [
          {
            contactId: officer.contactId,
            licenseId: officer.licenseId,
            name: "Other, Person",
          },
        ],
      ),
    ).rejects.toThrow(/conflicting person.*revoked-person/);
  });
  it("emits former assignments with source dates and agency details without a roster, coalescing repeated history", async () => {
    const result = await runPeople([
      { ...person, history: [history, { ...history, sourceRow: 3 }] },
    ]);
    const assignments = recordsOf(result, "AgencyPersonnel");
    expect(Object.keys(assignments)).toHaveLength(1);
    expect(Object.values(assignments)[0].spec).toMatchObject({
      personnel_id: officer.contactId,
      agency_id: "a2jALPHA",
      start_date: "1995-02-03",
      end_date: "2001-04-05",
      title: "Peace Officer",
      license_id: null,
    });
    expect(
      AgencyPersonnelSpec.safeParse(Object.values(assignments)[0].spec).success,
    ).toBe(true);
    expect(recordsOf(result, "Agencies").a2jALPHA.spec).toMatchObject({
      name: "Alpha Police Dept.",
      address: "100 Main St",
      city: "Alphaville",
    });
  });
  it("rejects conflicting license-derived titles for the same employment", async () => {
    const other = {
      ...person,
      licenseNumber: "67890",
      officer: {
        ...officer,
        licenseNumber: "67890",
        licenseId: "part-time-license",
        licenseType: "Part Time Peace Officer",
      },
      history: [history],
    };
    await expect(
      runPeople([{ ...person, history: [history] }, other]),
    ).rejects.toThrow(/conflicting history assignment.*revoked-person/);
  });
  it("retains personnel and discipline while reporting explicitly unresolved history relationships", async () => {
    const result = await runPeople(
      [
        {
          ...person,
          history: [
            history,
            { ...history, sourceRow: 7, agencyName: "Missing Police" },
          ],
        },
      ],
      undefined,
      undefined,
      [
        {
          agencyName: "Missing Police",
          reason: "site agency search returned no resolvable id",
          kind: "skip",
          candidateCount: 0,
        },
      ],
    );
    expect(result.personnelSourceNames).toEqual(["revoked-person"]);
    expect(Object.keys(recordsOf(result, "Disciplines"))).toEqual([
      "revoked-person|complaint1",
    ]);
    expect(Object.keys(recordsOf(result, "AgencyPersonnel"))).toHaveLength(1);
    expect(
      recordsOf(result, "LicensingAuthorities")["mn-post"].metadata?.defects,
    ).toEqual([
      {
        code: "employment-history-agency-not-found",
        type: "error",
        field: "agencyName",
        value: "Missing Police",
        message:
          "A past job at Missing Police (1995-02-03 to 2001-04-05) for license 12345 was left out because the state's license search did not return exactly one agency with that name.",
        evidence: [
          {
            file: "Law Enforcement Agencies request item 3 agency history DL 2026.xlsx",
            row: 7,
          },
        ],
        source_namespace: "com/site/my/mnitservices/post-license-search",
        source_record_id:
          "Law Enforcement Agencies request item 3 agency history DL 2026.xlsx#7",
      },
    ]);
    expect(accountingOf(result, "discipline-personnel.json history")).toEqual({
      input: "discipline-personnel.json history",
      read: 2,
      emitted: 1,
      reported: 1,
      notSelected: {},
    });
  });
  it("an unresolved report for another agency does not authorize omitting unknown history", async () => {
    await expect(
      runPeople(
        [
          {
            ...person,
            history: [{ ...history, agencyName: "Missing Police" }],
          },
        ],
        undefined,
        undefined,
        [
          {
            agencyName: "Different Police",
            reason: "no result",
            kind: "skip",
            candidateCount: 0,
          },
        ],
      ),
    ).rejects.toThrow(/Missing Police.*agency-ids/);
  });
  it("rejects a history agency that has no authoritative identity", async () => {
    await expect(
      runPeople([
        { ...person, history: [{ ...history, agencyName: "Missing Police" }] },
      ]),
    ).rejects.toThrow(/Missing Police.*agency-ids/);
  });
});

describe("com/site/my/mnitservices/post-license-search confirmed detail request identity", () => {
  async function runDetail(filename: string, returnedContact?: string) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-detail-identity-"));
    const officer = {
      contactId: "confirmed-person",
      licenseId: "confirmed-license",
      licenseNumber: "12527",
      name: "Fank, Patrick",
      licenseType: "Peace Officer",
      status: "Active",
      originalLicenseIssueDate: "1990-01-01",
    };
    const detail = JSON.stringify({
      licenses: {
        POSTLicenseList:
          returnedContact === undefined
            ? []
            : [{ ...officer, contactId: returnedContact }],
      },
      activeEmployment: [
        { rosterId: "confirmed-roster", agencyName: "Alpha Police Dept." },
      ],
    });
    const files = {
      "agency-ids.yaml": agencyIds,
      "alpha-police-dept.roster.json": JSON.stringify([officer]),
      "discipline-personnel.json": JSON.stringify({
        people: [
          {
            licenseNumber: "12527",
            sourceRow: 2,
            name: officer.name,
            officer,
            history: [],
          },
        ],
        missingActions: [],
      }),
      "discipline-unresolved-licenses.json": "[]",
      [filename]: detail,
    };
    try {
      for (const [name, contents] of Object.entries(files))
        await writeFile(path.join(dir, name), contents);
      const result = await transform({
        paths: Object.keys(files).map((name) => path.join(dir, name)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      });
      expect(await readFile(path.join(dir, filename), "utf8")).toBe(detail);
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  it("retains explicit employment when the confirmed request detail returns an empty license list", async () => {
    const result = await runDetail(
      `${artifactStem("confirmed-license")}.detail.json`,
    );
    expect(
      recordsOf(result, "AgencyPersonnel")["confirmed-roster"].spec,
    ).toMatchObject({
      personnel_id: "confirmed-person",
      agency_id: "a2jALPHA",
    });
  });
  it("does not assign employment from an unrelated detail filename", async () => {
    await expect(runDetail("unrelated.detail.json")).rejects.toThrow(
      /no activeEmployment rosterId/,
    );
  });
  it("rejects returned license contact identities that conflict with the confirmed request", async () => {
    await expect(
      runDetail(
        `${artifactStem("confirmed-license")}.detail.json`,
        "other-contact",
      ),
    ).rejects.toThrow(/detail.*contact mismatch/);
  });
});

describe("com/site/my/mnitservices/post-license-search left-out records", () => {
  const namespace = "com/site/my/mnitservices/post-license-search";
  const officer = {
    name: "Jones, Mary Ann",
    contactId: "0032",
    licenseId: "a2jLIC32",
    licenseType: "Peace Officer",
    status: "Active",
    originalLicenseIssueDate: "2015-03-15",
  };
  const employment = {
    activeEmployment: [
      { rosterId: "a2m32ALPHA", agencyName: "Alpha Police Dept." },
    ],
  };
  async function run(files: Record<string, string>) {
    const dir = await mkdtemp(path.join(tmpdir(), "mn-post-left-out-"));
    try {
      for (const [name, content] of Object.entries(files))
        await writeFile(path.join(dir, name), content);
      return await transform({
        paths: Object.keys(files).map((name) => path.join(dir, name)),
        readXlsx: async () => [],
        state: "/unused",
        emit: async () => {},
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const rosterFile = "alpha-police-dept-000000000001.roster.json";
  const authorityFindings = (manifest: SourceManifest) =>
    recordsOf(manifest, "LicensingAuthorities")["mn-post"].metadata?.defects;

  it.each([
    {
      patch: { originalLicenseIssueDate: "" },
      field: "originalLicenseIssueDate",
      value: "",
      missing: "license issue date",
    },
    {
      patch: { licenseType: null },
      field: "licenseType",
      value: null,
      missing: "license type",
    },
    {
      patch: { originalLicenseIssueDate: null, licenseType: "" },
      field: "originalLicenseIssueDate",
      value: null,
      missing: "license issue date or license type",
    },
  ])(
    "reports a roster row with no $missing on the Minnesota authority and emits no assignment",
    async ({ patch, field, value, missing }) => {
      const manifest = await run({
        "agency-ids.yaml": agencyIds,
        [rosterFile]: JSON.stringify([{ ...officer, ...patch }]),
        "a.detail.json": JSON.stringify({
          ...employment,
          licenses: {
            POSTLicenseList: [
              "licenseType" in patch ? officer : { ...officer, ...patch },
            ],
          },
        }),
      });
      expect(recordsOf(manifest, "AgencyPersonnel")).toEqual({});
      expect(Object.keys(recordsOf(manifest, "Personnel"))).toEqual(["0032"]);
      expect(authorityFindings(manifest)).toEqual([
        {
          code: "roster-officer-without-assignment",
          type: "error",
          field,
          value,
          message: `Mary Ann Jones is on the roster of Alpha Police Dept., but the roster gives no ${missing} for this officer, so the officer's job at the agency was left out.`,
          evidence: [{ file: rosterFile, row: 1 }],
          source_namespace: namespace,
          source_record_id: "a2jALPHA|a2jLIC32",
        },
      ]);
      expect(accountingOf(manifest, "roster.json officers")).toEqual({
        input: "roster.json officers",
        read: 1,
        emitted: 0,
        reported: 1,
        notSelected: {},
      });
      expect(accountingOf(manifest, "detail.json activeEmployment")).toEqual({
        input: "detail.json activeEmployment",
        read: 1,
        emitted: 0,
        reported: 1,
        notSelected: {},
      });
    },
  );

  it("reports a roster row with no first name on the Minnesota authority and emits no person", async () => {
    const manifest = await run({
      "agency-ids.yaml": agencyIds,
      [rosterFile]: JSON.stringify([{ ...officer, name: "Jones," }]),
    });
    expect(recordsOf(manifest, "Personnel")).toEqual({});
    expect(authorityFindings(manifest)).toEqual([
      {
        code: "roster-officer-without-name",
        type: "error",
        field: "name",
        value: "Jones,",
        message:
          "An officer on the roster of Alpha Police Dept. was left out because the roster gives no first name for the officer.",
        evidence: [{ file: rosterFile, row: 1 }],
        source_namespace: namespace,
        source_record_id: "a2jALPHA|a2jLIC32",
      },
    ]);
  });

  it("emits every reportable record with a defects list on a run with no findings", async () => {
    const manifest = await run({
      "agency-ids.yaml": agencyIds,
      [rosterFile]: JSON.stringify([officer]),
      "a.detail.json": JSON.stringify({
        ...employment,
        licenses: { POSTLicenseList: [officer] },
        disciplinaryActions: [
          {
            contactId: "0032",
            caseNumber: "PB-9",
            complaintId: "cmp-9",
            documentName: "Order",
            effectiveDate: "2020-01-01",
          },
        ],
      }),
    });
    expect(authorityFindings(manifest)).toEqual([]);
    expect(recordsOf(manifest, "Personnel")["0032"].metadata).toEqual({
      defects: [],
    });
    expect(recordsOf(manifest, "Disciplines")["0032|cmp-9"].metadata).toEqual({
      defects: [],
    });
  });

  it.each([
    [{ contactId: "" }, /row 2: blank contactId/],
    [{ licenseId: null }, /row 2: blank licenseId/],
    [{ originalLicenseIssueDate: "03/15/2015" }, /row 2 .*03\/15\/2015/],
  ])("throws on a roster row with %j", async (patch, message) => {
    await expect(
      run({
        "agency-ids.yaml": agencyIds,
        [rosterFile]: JSON.stringify([
          { ...officer, contactId: "0031", licenseId: "a2jLIC31" },
          { ...officer, ...patch },
        ]),
        "a.detail.json": JSON.stringify({
          activeEmployment: [
            { rosterId: "a2m31ALPHA", agencyName: "Alpha Police Dept." },
          ],
          licenses: { POSTLicenseList: [{ contactId: "0031" }] },
        }),
      }),
    ).rejects.toThrow(message);
  });

  it("throws when one contact has two names on the rosters", async () => {
    await expect(
      run({
        "agency-ids.yaml": agencyIds,
        [rosterFile]: JSON.stringify([{ ...officer, licenseType: null }]),
        "beta-county-sheriff-000000000002.roster.json": JSON.stringify([
          { ...officer, licenseType: null, name: "Jones, Marie" },
        ]),
      }),
    ).rejects.toThrow(/conflicting person 0032/);
  });

  it.each([
    ["a roster that is not a list", { [rosterFile]: "{}" }, /expected a list/],
    [
      "an agency-ids.yaml entry with a blank id",
      { "agency-ids.yaml": "Alpha Police Dept.:\n  id: ''\n" },
      /Alpha Police Dept\. has a blank id/,
    ],
    [
      "an agency CSV row with a blank agency name",
      {
        "agencies.csv": `${agenciesCsv}\n,Police,A Chief,1 St,Town,MN,55111,555,a@b.mn`,
      },
      /agencies\.csv row 3: blank agency name/,
    ],
    [
      "an agency CSV row with no roster and no skip report entry",
      {
        "agencies.csv": `${agenciesCsv}\nGamma Police Dept.,Police,A Chief,1 St,Town,MN,55111,555,a@b.mn`,
      },
      /agencies\.csv row 3: agency Gamma Police Dept\. has no roster/,
    ],
    [
      "an activeEmployment row with a blank rosterId",
      {
        "a.detail.json": JSON.stringify({
          licenses: { POSTLicenseList: [officer] },
          activeEmployment: [
            { rosterId: "", agencyName: "Alpha Police Dept." },
          ],
        }),
      },
      /a\.detail\.json activeEmployment row 1: blank rosterId or agencyName/,
    ],
    [
      "a detail value that is neither a list nor the site's none text",
      {
        "a.detail.json": JSON.stringify({
          ...employment,
          licenses: { POSTLicenseList: [officer] },
          education: null,
        }),
      },
      /a\.detail\.json education: expected a list or "No Courses found"/,
    ],
    [
      "an order document that no disciplinary action cites",
      { "orphan.document.json": document0031, "orphan.pdf": "pdf" },
      /orphan\.document\.json: no disciplinary action/,
    ],
    [
      "a skipped document that no disciplinary action cites",
      {
        "skipped.yaml": stringifyYaml({
          skippedAgencies: [],
          skippedOfficers: [],
          skippedDocuments: [
            {
              url: "https://example.mn/orders/none.pdf",
              actions: [{ contactId: "0032", caseNumber: "PB-0" }],
              reason: "source returned 404",
            },
          ],
        }),
      },
      /skipped\.yaml: no disciplinary action.*none\.pdf/,
    ],
    [
      "a skip report with no skippedAgencies list",
      { "skipped.yaml": stringifyYaml({ skippedDocuments: [] }) },
      /malformed skipped agency report/,
    ],
    [
      "discipline people with no unresolved-license report",
      {
        "discipline-personnel.json": JSON.stringify({
          people: [],
          missingActions: [],
        }),
      },
      /expects discipline-unresolved-licenses\.json/,
    ],
  ])("throws on %s", async (_case, files, message) => {
    await expect(
      run({
        "agency-ids.yaml": agencyIds,
        "agencies.csv": agenciesCsv,
        [rosterFile]: JSON.stringify([officer]),
        "a.detail.json": JSON.stringify({
          ...employment,
          licenses: { POSTLicenseList: [officer] },
        }),
        ...files,
      }),
    ).rejects.toThrow(message);
  });

  it("reports an unavailable order document on the discipline record", async () => {
    const discipline = recordsOf(await runFixture(), "Disciplines");
    expect(discipline["0099|complaint99"].metadata).toEqual({
      defects: [
        {
          code: "order-document-unavailable",
          type: "warning",
          field: "document_url",
          value: "https://example.mn/orders/PB20-1-09.pdf",
          message:
            "The order for case PB20-1-09 could not be downloaded from the state's site, so what the order says is not shown.",
          evidence: [
            {
              url: "https://example.mn/orders/PB20-1-09.pdf",
              reason: "source returned 404",
            },
          ],
          source_namespace: namespace,
          source_record_id: "complaint99",
        },
      ],
    });
    expect(discipline["0031|cmp-001"].metadata).toEqual({ defects: [] });
  });

  it("reports skipped agencies, unresolved licenses and licenses with no listed action on the Minnesota authority", async () => {
    const disciplined = {
      contactId: "0050",
      licenseId: "a2jLIC50",
      licenseNumber: "50000",
      name: "Doe, Pat",
      licenseType: "Peace Officer",
      status: "Revoked",
      originalLicenseIssueDate: "1990-01-01",
    };
    const manifest = await run({
      "agency-ids.yaml": agencyIds,
      "agencies.csv": [
        agenciesCsv,
        "Gamma Police Dept.,Police,A Chief,1 St,Town,MN,55111,555,a@b.mn",
        "Delta Police Dept.,Police,B Chief,2 St,Town,MN,55111,555,b@b.mn",
      ].join("\n"),
      [rosterFile]: JSON.stringify([officer]),
      "a.detail.json": JSON.stringify({
        ...employment,
        licenses: { POSTLicenseList: [officer] },
        disciplinaryActions: "No POST Disciplinary Actions found",
        education: "No Courses found",
      }),
      "b.detail.json": JSON.stringify({
        licenses: { POSTLicenseList: [disciplined] },
        disciplinaryActions: "No POST Disciplinary Actions found",
        activeEmployment: "No employment found",
      }),
      "skipped.yaml": stringifyYaml({
        skippedAgencies: [
          {
            agencyName: "Gamma Police Dept.",
            reason: "excluded by an Agency entry in excluded.yaml",
          },
          {
            agencyName: "Delta Police Dept.",
            reason: "site agency search returned no resolvable id",
            candidateCount: 0,
          },
        ],
        skippedOfficers: [],
        skippedDocuments: [],
      }),
      "discipline-personnel.json": JSON.stringify({
        people: [
          {
            licenseNumber: "50000",
            name: "Pat Doe",
            sourceRow: 12,
            officer: disciplined,
            history: [],
          },
        ],
        missingActions: [{ licenseNumber: "50000", contactId: "0050" }],
      }),
      "discipline-unresolved-licenses.json": JSON.stringify([
        {
          licenseNumber: "83259",
          name: "Alan Gene Wahl",
          sourceRow: 196,
          history: [],
          reason: "License 83259: expected one exact search result, got 0",
          results: [],
        },
      ]),
    });
    const workbook = "Final Disciplinary Actions item 5 DL 9-26.xlsx";
    expect(authorityFindings(manifest)).toEqual([
      {
        code: "agency-not-found",
        type: "error",
        field: "Agency",
        value: "Delta Police Dept.",
        message:
          "Delta Police Dept. is on the state's list of law enforcement agencies, but the state's license search did not return exactly one agency with that name, so the agency and its officers were left out.",
        evidence: [{ file: "skipped.yaml", agency: "Delta Police Dept." }],
        source_namespace: namespace,
        source_record_id: "Delta Police Dept.",
      },
      {
        code: "disciplined-license-without-action",
        type: "error",
        field: "disciplinaryActions",
        value: null,
        message:
          "License 50000 (Pat Doe) is on the state's list of disciplined officers, but the state's license search lists no disciplinary action for it, so no discipline was added for this officer.",
        evidence: [{ file: workbook, row: 12 }],
        source_namespace: namespace,
        source_record_id: "50000",
      },
      {
        code: "disciplined-license-not-found",
        type: "error",
        field: "licenseNumber",
        value: "83259",
        message:
          "License 83259 (Alan Gene Wahl) is on the state's list of disciplined officers, but the state's license search did not return exactly one matching license, so the officer and the discipline were left out.",
        evidence: [{ file: workbook, row: 196 }],
        source_namespace: namespace,
        source_record_id: "83259",
      },
    ]);
    expect(manifest.accounting).toEqual([
      {
        input: "agency-ids.yaml",
        read: 2,
        emitted: 1,
        reported: 0,
        notSelected: { "no roster or employment history": 1 },
      },
      {
        input: "agencies.csv",
        read: 3,
        emitted: 1,
        reported: 1,
        notSelected: { excluded: 1 },
      },
      {
        input: "roster.json officers",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "detail.json licenses",
        read: 2,
        emitted: 2,
        reported: 0,
        notSelected: {},
      },
      {
        input: "detail.json activeEmployment",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "detail.json disciplinaryActions",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
      {
        input: "detail.json education",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
      {
        input: "discipline-personnel.json people",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "discipline-personnel.json history",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
      {
        input: "discipline-personnel.json missingActions",
        read: 1,
        emitted: 0,
        reported: 1,
        notSelected: {},
      },
      {
        input: "discipline-unresolved-licenses.json",
        read: 1,
        emitted: 0,
        reported: 1,
        notSelected: {},
      },
      {
        input: "document.json",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
      {
        input: "skipped.yaml skippedAgencies",
        read: 2,
        emitted: 0,
        reported: 1,
        notSelected: { excluded: 1 },
      },
      {
        input: "skipped.yaml skippedDocuments",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
    ]);
  });

  it("counts an active employment at an agency whose roster does not list the officer", async () => {
    const manifest = await run({
      "agency-ids.yaml": agencyIds,
      [rosterFile]: JSON.stringify([officer]),
      "a.detail.json": JSON.stringify({
        licenses: { POSTLicenseList: [officer] },
        activeEmployment: [
          ...employment.activeEmployment,
          { rosterId: "a2m32BETA", agencyName: "Beta County Sheriff" },
        ],
      }),
    });
    expect(Object.keys(recordsOf(manifest, "AgencyPersonnel"))).toEqual([
      "a2m32ALPHA",
    ]);
    expect(accountingOf(manifest, "detail.json activeEmployment")).toEqual({
      input: "detail.json activeEmployment",
      read: 2,
      emitted: 1,
      reported: 0,
      notSelected: { "officer is not on that agency's roster": 1 },
    });
  });

  it("accounts for every row of the shared fixture", async () => {
    const { accountingTotals } =
      await import("../../../../../../../src/cli/transform/accounting.js");
    expect(accountingTotals(namespace, (await runFixture()).accounting)).toBe(
      `${namespace}: row accounting: ` +
        [
          "agency-ids.yaml: read 2, emitted 2, reported 0, not selected 0",
          "agencies.csv: read 1, emitted 1, reported 0, not selected 0",
          "roster.json officers: read 4, emitted 4, reported 0, not selected 0",
          "detail.json licenses: read 4, emitted 4, reported 0, not selected 0",
          "detail.json activeEmployment: read 4, emitted 4, reported 0, not selected 0",
          "detail.json disciplinaryActions: read 2, emitted 2, reported 0, not selected 0",
          "detail.json education: read 0, emitted 0, reported 0, not selected 0",
          "discipline-personnel.json people: read 0, emitted 0, reported 0, not selected 0",
          "discipline-personnel.json history: read 0, emitted 0, reported 0, not selected 0",
          "discipline-personnel.json missingActions: read 0, emitted 0, reported 0, not selected 0",
          "discipline-unresolved-licenses.json: read 0, emitted 0, reported 0, not selected 0",
          "document.json: read 1, emitted 1, reported 0, not selected 0",
          "skipped.yaml skippedAgencies: read 0, emitted 0, reported 0, not selected 0",
          "skipped.yaml skippedDocuments: read 1, emitted 1, reported 0, not selected 0",
        ].join("; "),
    );
  });
});
