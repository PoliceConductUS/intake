import { moduleSourceNamespace } from "../../../../../src/cli/source-namespace.js";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, relative } from "node:path";
import { manifestSchema } from "./manifest.js";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../../../../src/cli/transform/source-transform.js";
import type { InputAccounting } from "../../../../../src/cli/transform/accounting.js";
import type { Finding } from "../../../../../src/shared/data-annotations.js";
import { AgencySpec } from "../../../../../src/shared/io/index.js";
import { canonicalLicenseType } from "../../../../../src/shared/license.js";
import {
  BASE_URL,
  nextPage,
  parseSearch,
  parseAgency,
  parseEmployment,
  parseCertificates,
  type Affiliation,
  type Certificate,
} from "./parse.js";
import { buildEmploymentEpisodes, sourceDate } from "./employment.js";

const SOURCE = moduleSourceNamespace(import.meta.url);
const agencyFieldLabels: Record<string, string> = {
  name: "name",
  address: "address",
  city: "city",
  state: "state",
  zip_code: "ZIP code",
};
const employmentFindings = {
  "no-start": {
    code: "employment-without-start",
    reason: "the records do not show when that employment started",
  },
  "ambiguous-position": {
    code: "employment-position-ambiguous",
    reason:
      "it could not be matched to one of the officer's positions at the agency",
  },
  "ambiguous-period": {
    code: "employment-unclear",
    reason: "another record could not be matched to it with certainty",
  },
  "untitled-period": {
    code: "employment-without-position",
    reason: "the records give no rank or position for it",
  },
  "open-period": {
    code: "employment-without-end",
    reason:
      "the records give no end date for it and do not show the officer as active at the agency",
  },
};
const periodOutcomes = new Set([
  "ambiguous-period",
  "untitled-period",
  "open-period",
]);
function input(name: string): InputAccounting {
  return { input: name, read: 0, emitted: 0, reported: 0, notSelected: {} };
}
function notSelected(accounting: InputAccounting, reason: string): void {
  accounting.notSelected[reason] = (accounting.notSelected[reason] ?? 0) + 1;
}
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
  const searchRows = input("search pages"),
    agencyPages = input("agency pages"),
    employmentRows = input("employment pages"),
    certificateRows = input("certificate pages");
  const defects: Finding[] = [];
  const officers = uniqueById(manifest.officers),
    agencyFiles = uniqueById(manifest.agencies);
  const affiliations: Affiliation[] = [];
  const affiliationKeys = new Map<string, string>();
  for (const page of searchPages)
    for (const a of parseSearch(page)) {
      searchRows.read++;
      const key = `${a.officerId}|${a.agencyId}|${a.recordId}|${a.recordNumber}`;
      const value = JSON.stringify(a);
      if (affiliationKeys.has(key)) {
        if (affiliationKeys.get(key) !== value)
          throw Error(`Conflicting affiliation ${key}`);
        notSelected(searchRows, "repeated row");
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
    const name = [...expectedNames][0]!;
    agencyPages.read++;
    const a = parseAgency(await read(file), name);
    const url = new URL("AgencyList.aspx", BASE_URL);
    url.searchParams.set("Agcy", id);
    const report = (
      finding: Pick<Finding, "code" | "value" | "message">,
    ): void => {
      defects.push({
        ...finding,
        type: "warning",
        field: "agencies",
        evidence: [{ url: url.href, file }],
        source_namespace: SOURCE,
        source_record_id: id,
      });
      agencyPages.reported++;
    };
    if (!a) {
      report({
        code: "agency-not-in-agency-list",
        value: null,
        message: `${name} (agency ${id}) is named in the department's officer records, but the department's agency list has no entry for it, so it is not listed here. Employment at this agency is not listed either.`,
      });
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
      const unusable = [
        ...new Set(
          candidate.error.issues.map((issue) => {
            const label = agencyFieldLabels[String(issue.path[0])];
            if (!label)
              throw Error(
                `${SOURCE}: agency ${id} fails the agency schema at an unexpected field: ${issue.path.join(".")}: ${issue.message}`,
              );
            return label;
          }),
        ),
      ];
      report({
        code: "agency-not-buildable",
        value: a,
        message: `${name} (agency ${id}) is in the department's agency list but is not listed here because its ${new Intl.ListFormat("en", { type: "conjunction" }).format(unusable)} ${unusable.length === 1 ? "is" : "are"} missing or not usable. Employment at this agency is not listed either.`,
      });
      continue;
    }
    put(agencies, id, candidate.data);
    if (a.phone)
      put(phones, `${id}|Phone`, {
        agency_id: id,
        phone_number: a.phone,
        description: "Phone",
      });
  }
  const agencyIdsByName = new Map<string, Set<string>>();
  for (const a of affiliations) {
    put(personnel, a.officerId, { id: a.officerId, ...person(a.name) });
    searchRows.emitted++;
    const ids = agencyIdsByName.get(a.agencyName) ?? new Set();
    ids.add(a.agencyId);
    agencyIdsByName.set(a.agencyName, ids);
  }
  for (const officer of manifest.officers) {
    if (!personnel[officer.id])
      throw Error(`Manifest officer ${officer.id} has no search evidence`);
    const certificates = (
      await readPages(
        officer.certificateFiles,
        `officer-${officer.id}-certificates`,
      )
    ).flatMap((html, page) =>
      parseCertificates(html, officer.id).map((certificate, row) => ({
        certificate,
        at: `${officer.certificateFiles[page]} row ${row + 1}`,
      })),
    );
    const employmentStem = `officer-${officer.id}-employment`;
    const employment = (
      await readPages(officer.employmentFiles, employmentStem)
    )
      .flatMap((html, page) =>
        parseEmployment(html, officer.id).map((event, row) => ({
          event,
          file: officer.employmentFiles[page]!,
          row: row + 1,
        })),
      )
      .map((source, index, all) => ({
        ...source,
        id: `${employmentStem}#${all.length - index}`,
      }));
    const ownAffiliations = affiliations.filter(
      (a) => a.officerId === officer.id,
    );
    const report = (
      { event, file, row, id }: (typeof employment)[number],
      code: string,
      message: string,
    ): void => {
      defects.push({
        code,
        type: "warning",
        field: "agency_personnel",
        value: event,
        message,
        evidence: [{ url: ownAffiliations[0]!.detailUrl, file, row }],
        source_namespace: SOURCE,
        source_record_id: id,
      });
      employmentRows.reported++;
    };
    const record = ({ event }: (typeof employment)[number]) =>
      `An employment record of officer ${officer.id} at ${event.agencyName} (${event.action}, ${event.date})`;
    const identifiedEmployment: typeof employment = [];
    for (const source of employment) {
      employmentRows.read++;
      const ids = agencyIdsByName.get(source.event.agencyName);
      if (!ids)
        report(
          source,
          "employment-agency-unknown",
          `${record(source)} is in the department's records but is not listed here because the agency could not be identified.`,
        );
      else if (![...ids].some((id) => agencies[id])) employmentRows.reported++;
      else identifiedEmployment.push(source);
    }
    const episodes = buildEmploymentEpisodes(
      identifiedEmployment.map((source) => source.event),
      ownAffiliations,
      affiliations,
    );
    for (const issue of episodes.issues)
      log(`AgencyPersonnel for Personnel ${officer.id}: ${issue}`);
    for (const [index, outcome] of episodes.rows.entries()) {
      const source = identifiedEmployment[index]!;
      if (outcome === "assigned") employmentRows.emitted++;
      else if (outcome === "left-out-period") employmentRows.reported++;
      else if (outcome === "repeated")
        notSelected(employmentRows, "repeated row");
      else if (outcome === "certification-action")
        notSelected(employmentRows, "certification action");
      else if (outcome === "ended")
        notSelected(employmentRows, "separation after separation");
      else if (outcome === "leave-while-inactive")
        notSelected(employmentRows, "leave while not in active service");
      else if (outcome === "agency-identity")
        throw Error(
          `${SOURCE}: ${source.file} row ${source.row} names agency "${source.event.agencyName}", which has more than one agency code`,
        );
      else if (outcome === "unresolved-action")
        throw Error(
          `${SOURCE}: ${source.file} row ${source.row} has an unknown action "${source.event.action}"`,
        );
      else {
        const { code, reason } = employmentFindings[outcome];
        report(
          source,
          code,
          `${
            periodOutcomes.has(outcome)
              ? `The employment of officer ${officer.id} at ${source.event.agencyName} that started on ${source.event.date}`
              : record(source)
          } is in the department's records but is not listed here because ${reason}.`,
        );
      }
    }
    for (const episode of episodes.assignments)
      put(
        assignments,
        `${officer.id}|${episode.agencyId}|${episode.startDate}`,
        {
          agency_id: episode.agencyId,
          personnel_id: officer.id,
          start_date: episode.startDate,
          end_date: episode.endDate,
          title: episode.title,
        },
      );
    const holdings = new Map<string, Certificate[]>();
    const seenCertificates = new Set<string>();
    for (const { certificate: c, at } of certificates) {
      certificateRows.read++;
      const content = JSON.stringify(c);
      if (seenCertificates.has(content)) {
        notSelected(certificateRows, "repeated row");
        continue;
      }
      seenCertificates.add(content);
      for (const [cell, value] of [
        ["certificate type", c.certificate],
        ["status", c.status],
        ["status date", c.statusDate],
      ])
        if (!value) throw Error(`${SOURCE}: ${at} has a blank ${cell}`);
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
        const date = sourceDate(c.statusDate);
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
        put(actions, `${holdingKey}|${c.status}|${date}`, {
          license_id: holdingKey,
          action: c.status,
          action_date: date,
          status: c.status,
        });
        certificateRows.emitted++;
      }
      const latest = [...statuses.keys()].sort().at(-1)!;
      put(licenses, holdingKey, {
        personnel_id: officer.id,
        authority_license_id: authorityKey,
        first_awarded: awards[0] ?? null,
        status: statuses.get(latest),
      });
    }
  }
  // Only agencies with a retained employment relationship belong to this output.
  const retainedAgencies = new Set(
    Object.values(assignments).map(
      (record) => (record.spec as { agency_id: string }).agency_id,
    ),
  );
  for (const id of Object.keys(agencies)) {
    if (retainedAgencies.has(id)) agencyPages.emitted++;
    else {
      delete agencies[id];
      delete phones[`${id}|Phone`];
      notSelected(agencyPages, "no AgencyPersonnel");
    }
  }
  const artifacts = [
    {
      kind: "LicensingAuthorities" as const,
      records: {
        dpsst: {
          metadata: { defects },
          spec: {
            name: "Oregon Department of Public Safety Standards and Training",
            abbreviation: "DPSST",
            source_namespaces: [SOURCE],
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
    `prefixes ${manifest.prefixes.join(", ")}; ${defects.length} findings; ${artifacts.map((a) => `${Object.keys(a.records).length} ${a.kind}`).join(", ")}`,
  );
  return {
    artifacts,
    accounting: [searchRows, agencyPages, employmentRows, certificateRows],
  };
};
