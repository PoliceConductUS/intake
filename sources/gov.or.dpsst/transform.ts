import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, relative } from "node:path";
import { manifestSchema } from "./manifest.js";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../src/cli/transform/source-transform.js";
import {
  AgencySpec,
  type ImportArtifactKind,
} from "../../src/shared/io/index.js";
import { canonicalLicenseType } from "../../src/shared/license.js";
import {
  nextPage,
  parseSearch,
  parseAgency,
  parseEmployment,
  parseCertificates,
  type Affiliation,
  type Certificate,
} from "./parse.js";
import { buildEmploymentEpisodes, sourceDate } from "./employment.js";

export const description =
  "Oregon DPSST public roster, employment history and certifications.";
export const produces: readonly ImportArtifactKind[] = [
  "LicensingAuthorities",
  "AuthorityLicenses",
  "Agencies",
  "Personnel",
  "AgencyPersonnel",
  "Licenses",
  "LicenseActions",
  "AgencyPhoneNumbers",
];
function put(records: EmittedRecords, key: string, spec: unknown): void {
  const previous = records[key];
  if (previous && JSON.stringify(previous.spec) !== JSON.stringify(spec))
    throw Error(`Conflicting source identity ${key}`);
  records[key] = { spec };
}
function uniqueById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (result.has(row.id))
      throw Error(`Duplicate manifest identity ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}
function person(name: string) {
  const parts = name.split(",").map((s) => s.trim());
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1])
    throw Error(`Malformed personnel name: ${name}`);
  const names = parts[1].split(/\s+/);
  let suffix = parts[2] || null;
  if (names.length > 1 && /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(names.at(-1)!)) {
    if (suffix) throw Error(`Ambiguous name suffix: ${name}`);
    suffix = names.pop()!;
  }
  if (suffix && !/^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(suffix))
    throw Error(`Malformed name suffix: ${name}`);
  return {
    first_name: names[0]!,
    last_name: parts[0],
    middle_name: names.slice(1).join(" ") || null,
    suffix,
  };
}

export const transform: SourceTransform = async ({ paths, logger }) => {
  const manifests = paths.filter((p) => basename(p) === "manifest.json");
  if (manifests.length !== 1)
    throw Error("Oregon DPSST requires exactly one complete manifest.json");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifests[0]!, "utf8")),
  );
  if (!manifest.complete) throw Error("Oregon acquisition is incomplete");
  const root = dirname(manifests[0]!);
  const read = async (file: string) => {
    const path = resolve(root, file);
    if (isAbsolute(file) || relative(root, path).startsWith(".."))
      throw Error(`Invalid raw evidence path ${file}`);
    return readFile(path, "utf8");
  };
  const readPages = async (
    files: string[],
    stem: string,
  ): Promise<string[]> => {
    const html: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const expected = `${stem}-${index + 1}.html`;
      if (files[index] !== expected)
        throw Error(`Invalid page files: expected ${expected}`);
      const page = await read(expected);
      const next = nextPage(page, index + 1);
      if (Boolean(next) !== index + 1 < files.length)
        throw Error(`Incomplete or extra page files after ${expected}`);
      html.push(page);
    }
    if (!html.length) throw Error(`Missing page files for ${stem}`);
    return html;
  };
  if (
    new Set(manifest.prefixes.map((p) => p.toUpperCase())).size !==
      manifest.prefixes.length ||
    manifest.prefixes.some((p) => !/^[a-z]+$/i.test(p))
  )
    throw Error("Invalid manifest prefixes");
  const searchPages: string[] = [];
  let searchCount = 0;
  for (const prefix of manifest.prefixes) {
    const files = manifest.searchFiles.filter((f) =>
      f.startsWith(`search-${prefix}-`),
    );
    searchCount += files.length;
    searchPages.push(...(await readPages(files, `search-${prefix}`)));
  }
  if (searchCount !== manifest.searchFiles.length)
    throw Error("Unexpected search page files");
  const log = (message: string) => logger?.info(`dpsst: ${message}`);
  let omissions = 0;
  const omit = (message: string) => {
    omissions++;
    log(`omitted ${message}`);
  };
  const officers = uniqueById(manifest.officers),
    agencyFiles = uniqueById(manifest.agencies);
  const affiliations: Affiliation[] = [];
  const affiliationKeys = new Map<string, string>();
  for (const page of searchPages)
    for (const a of parseSearch(page)) {
      const key = `${a.officerId}|${a.agencyId}|${a.recordId}|${a.recordNumber}`;
      const value = JSON.stringify(a);
      if (affiliationKeys.has(key)) {
        if (affiliationKeys.get(key) !== value)
          throw Error(`Conflicting affiliation ${key}`);
        continue;
      }
      affiliationKeys.set(key, value);
      affiliations.push(a);
      if (!officers.has(a.officerId))
        throw Error(`Missing manifest officer ${a.officerId}`);
      if (!agencyFiles.has(a.agencyId))
        throw Error(`Missing manifest agency ${a.agencyId}`);
    }
  const agencies: EmittedRecords = {},
    personnel: EmittedRecords = {},
    assignments: EmittedRecords = {},
    phones: EmittedRecords = {},
    authorityLicenses: EmittedRecords = {},
    licenses: EmittedRecords = {},
    actions: EmittedRecords = {};
  for (const { id, file } of manifest.agencies) {
    const expectedNames = new Set(
      affiliations
        .filter((row) => row.agencyId === id)
        .map((row) => row.agencyName),
    );
    if (expectedNames.size !== 1)
      throw Error(`Conflicting agency names for ${id}`);
    const a = parseAgency(await read(file), [...expectedNames][0]!);
    if (!a) {
      omit(`agency ${id}: unavailable (No Data Found)`);
      continue;
    }
    const candidate = AgencySpec.safeParse({
      name: a.name,
      address: a.address || null,
      city: a.city || null,
      state: a.state,
      zip_code: a.zipCode || null,
      contact_name: a.contactName,
      contact_email: a.contactEmail,
      status: a.status || null,
    });
    if (!candidate.success) {
      omit(`agency ${id}: ${candidate.error.message}`);
      continue;
    }
    if (!a.address || !a.city || !a.zipCode)
      log(`agency ${id}: partial address retained for shared validation`);
    put(agencies, id, candidate.data);
    if (a.phone)
      put(phones, `${id}|Phone`, {
        agency_id: id,
        phone_number: a.phone,
        description: "Phone",
      });
  }
  for (const a of affiliations)
    put(personnel, a.officerId, { id: a.officerId, ...person(a.name) });
  const availableAgencyNames = new Set(
    affiliations.filter((a) => agencies[a.agencyId]).map((a) => a.agencyName),
  );
  for (const officer of manifest.officers) {
    if (!personnel[officer.id])
      throw Error(`Manifest officer ${officer.id} has no search evidence`);
    const employment = (
      await readPages(
        officer.employmentFiles,
        `officer-${officer.id}-employment`,
      )
    ).flatMap((html) => parseEmployment(html, officer.id));
    const missingAgencyRows = new Map<string, number>();
    const identifiedEmployment = employment.filter((event) => {
      if (availableAgencyNames.has(event.agencyName)) return true;
      missingAgencyRows.set(
        event.agencyName,
        (missingAgencyRows.get(event.agencyName) ?? 0) + 1,
      );
      return false;
    });
    for (const [name, count] of missingAgencyRows)
      omit(
        `AgencyPersonnel for Personnel ${officer.id}: ${name}: missing Agency; ${count} source rows retained`,
      );
    const episodes = buildEmploymentEpisodes(
      identifiedEmployment,
      affiliations.filter((a) => a.officerId === officer.id),
      affiliations,
    );
    for (const issue of episodes.issues)
      omit(`AgencyPersonnel for Personnel ${officer.id}: ${issue}`);
    for (const episode of episodes.assignments) {
      const key = `${officer.id}|${episode.agencyId}|${episode.startDate}`;
      if (!agencies[episode.agencyId]) {
        omit(`AgencyPersonnel ${key}: missing Agency ${episode.agencyId}`);
        continue;
      }
      put(assignments, key, {
        agency_id: episode.agencyId,
        personnel_id: officer.id,
        start_date: episode.startDate,
        end_date: episode.endDate,
        title: episode.title,
      });
    }
    const certificates = (
      await readPages(
        officer.certificateFiles,
        `officer-${officer.id}-certificates`,
      )
    ).flatMap((html) => parseCertificates(html, officer.id));
    const holdings = new Map<string, Certificate[]>();
    for (const c of new Map(
      certificates.map((c) => [JSON.stringify(c), c]),
    ).values()) {
      if (!c.certificate) {
        omit(`certificate ${officer.id}: missing certificate type`);
        continue;
      }
      for (const date of [
        c.statusDate,
        c.certificateDate,
        c.expirationDate,
        c.probationDate,
      ])
        if (date) sourceDate(date);
      const type = canonicalLicenseType(`${c.certificate} ${c.level}`);
      const group = holdings.get(type) ?? [];
      group.push(c);
      holdings.set(type, group);
    }
    for (const [type, rows] of holdings) {
      const authorityKey = `dpsst|${type}`,
        holdingKey = `${officer.id}|${type}`;
      put(authorityLicenses, authorityKey, {
        licensing_authority_id: "dpsst",
        name: type,
      });
      const awards = rows
        .map((c) => (c.certificateDate ? sourceDate(c.certificateDate) : null))
        .filter((d): d is string => d !== null)
        .sort();
      const statuses = new Map<string, string>();
      const sourceActions = new Map<string, string>();
      for (const c of rows) {
        const date = c.statusDate ? sourceDate(c.statusDate) : "";
        const sourceKey = `${date}|${c.status}`;
        const evidence = JSON.stringify(c);
        if (
          sourceActions.has(sourceKey) &&
          sourceActions.get(sourceKey) !== evidence
        )
          throw Error(
            `Conflicting certificate evidence ${holdingKey} ${sourceKey}`,
          );
        sourceActions.set(sourceKey, evidence);
        if (statuses.has(date) && statuses.get(date) !== c.status)
          throw Error(`Conflicting certificate status ${holdingKey} ${date}`);
        statuses.set(date, c.status);
        if (c.status && date)
          put(actions, `${holdingKey}|${c.status}|${date}`, {
            license_id: holdingKey,
            action: c.status,
            action_date: date,
            status: c.status,
          });
        else
          omit(`license action ${holdingKey}: missing status or status date`);
      }
      if (statuses.size > 1 && statuses.has(""))
        throw Error(`Undated conflicting certificate status ${holdingKey}`);
      const latest = [...statuses.keys()].sort().at(-1)!;
      put(licenses, holdingKey, {
        personnel_id: officer.id,
        authority_license_id: authorityKey,
        first_awarded: awards[0] ?? null,
        status: statuses.get(latest) || null,
      });
    }
  }
  const artifacts = [
    {
      kind: "LicensingAuthorities" as const,
      records: {
        dpsst: {
          spec: {
            name: "Oregon Department of Public Safety Standards and Training",
            abbreviation: "DPSST",
            source_namespaces: ["gov.or.dpsst"],
            website: "https://www.oregon.gov/dpsst/",
            location_path_id: "or",
          },
        },
      },
    },
    { kind: "AuthorityLicenses" as const, records: authorityLicenses },
    { kind: "Agencies" as const, records: agencies },
    { kind: "Personnel" as const, records: personnel },
    { kind: "AgencyPersonnel" as const, records: assignments },
    { kind: "Licenses" as const, records: licenses },
    { kind: "LicenseActions" as const, records: actions },
    { kind: "AgencyPhoneNumbers" as const, records: phones },
  ];
  log(
    `prefixes ${manifest.prefixes.join(", ")}; ${omissions} omissions/issues; ${artifacts.map((a) => `${Object.keys(a.records).length} ${a.kind}`).join(", ")}`,
  );
  return { artifacts };
};
