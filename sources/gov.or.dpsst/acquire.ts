import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import { createClient, type RequestHtml } from "./client.js";
import {
  BASE_URL,
  parseSearch,
  parseAgency,
  parseEmployment,
  parseCertificates,
  postbackFields,
  nextPage,
  type Affiliation,
} from "./parse.js";
import { manifestSchema, type AcquisitionManifest } from "./manifest.js";
async function previousManifest(
  sourceDir: string,
): Promise<AcquisitionManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.join(sourceDir, "manifest.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return manifestSchema.parse(JSON.parse(raw));
}
async function completedPages(
  sourceDir: string,
  files: string[],
  stem: string,
  validate: (html: string) => unknown,
): Promise<string[] | undefined> {
  if (!files.length) return undefined;
  const pages: string[] = [];
  const signatures = new Set<string>();
  for (const [index, file] of files.entries()) {
    if (file !== `${stem}-${index + 1}.html`)
      throw Error(`Invalid saved page sequence: ${file}`);
    const html = await readFile(path.join(sourceDir, file), "utf8");
    const signature = JSON.stringify(validate(html));
    if (signatures.has(signature)) throw Error(`Repeated saved page: ${file}`);
    signatures.add(signature);
    const next = nextPage(html, index + 1);
    if (index < files.length - 1 && next?.page !== index + 2)
      throw Error(`Invalid saved pagination: ${file}`);
    if (index === files.length - 1 && next) return undefined;
    pages.push(html);
  }
  return pages;
}
export async function acquireOregon({
  sourceDir,
  prefixes,
  request,
  log = () => {},
}: {
  sourceDir: string;
  prefixes: string[];
  request: RequestHtml;
  log?: (message: string) => void;
}): Promise<void> {
  if (
    !prefixes.length ||
    prefixes.some((p) => !/^[A-Za-z]+$/.test(p)) ||
    new Set(prefixes.map((p) => p.toUpperCase())).size !== prefixes.length
  )
    throw Error("Oregon prefixes must be distinct alphabetic names");
  await mkdir(sourceDir, { recursive: true });
  const previous = await previousManifest(sourceDir);
  if (
    previous &&
    JSON.stringify(previous.prefixes) !== JSON.stringify(prefixes)
  )
    throw Error(
      "Cannot resume Oregon acquisition with a different prefix scope",
    );
  const manifest: AcquisitionManifest = previous
    ? structuredClone(previous)
    : {
        version: 1,
        complete: false,
        prefixes,
        searchFiles: [],
        officers: [],
        agencies: [],
      };
  manifest.complete = false;
  for (const entries of [manifest.officers, manifest.agencies]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw Error("Duplicate saved manifest identity");
  }
  if (
    new Set(manifest.searchFiles).size !== manifest.searchFiles.length ||
    manifest.searchFiles.some(
      (file) =>
        !prefixes.some((prefix) => file.startsWith(`search-${prefix}-`)),
    )
  )
    throw Error("Invalid saved search identities");
  const saveManifest = () =>
    writeFile(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  await saveManifest();
  const searchUrl = new URL("EmployeeSearch.aspx", BASE_URL).href;
  let sessionStarted = false;
  const save = async (url: string, file: string, body?: URLSearchParams) => {
    if (!sessionStarted && url !== searchUrl) {
      const form = await request(searchUrl);
      postbackFields(form);
      await writeFile(path.join(sourceDir, "session-form.html"), form);
    }
    sessionStarted = true;
    const html = await request(url, body);
    await writeFile(path.join(sourceDir, file), html);
    return html;
  };
  const affiliations = new Map<string, Affiliation>();
  for (const prefix of prefixes) {
    const savedFiles =
      previous?.searchFiles.filter((file) =>
        file.startsWith(`search-${prefix}-`),
      ) ?? [];
    const savedPages = await completedPages(
      sourceDir,
      savedFiles,
      `search-${prefix}`,
      parseSearch,
    );
    if (savedPages) {
      for (const html of savedPages)
        for (const row of parseSearch(html)) {
          const earlier = affiliations.get(row.recordId);
          if (earlier && JSON.stringify(earlier) !== JSON.stringify(row))
            throw Error(`Conflicting affiliation ${row.recordId}`);
          affiliations.set(row.recordId, row);
        }

      log(
        `Oregon search ${prefix}: reused ${savedFiles.length} validated pages`,
      );
      continue;
    }
    manifest.searchFiles = manifest.searchFiles.filter(
      (file) => !file.startsWith(`search-${prefix}-`),
    );
    const url = new URL("EmployeeSearch.aspx", BASE_URL).href;
    let html = await save(url, `search-${prefix}-form.html`);
    let body = postbackFields(html);
    body.set("rdoSearchOption", "0");
    body.set("txtNameSearch", prefix);
    body.set("cmdSearch", "Find");
    let page = 1;
    const seen = new Set<string>();
    while (true) {
      const file = `search-${prefix}-${page}.html`;
      html = await save(url, file, body);
      const rows = parseSearch(html);
      const signature = JSON.stringify(rows);
      if (seen.has(signature)) throw Error("Repeated search page");
      seen.add(signature);
      manifest.searchFiles.push(file);
      for (const row of rows) {
        const previous = affiliations.get(row.recordId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(row))
          throw Error(`Conflicting affiliation ${row.recordId}`);
        affiliations.set(row.recordId, row);
      }
      await saveManifest();
      const next = nextPage(html, page);
      if (!next) break;
      if (!rows.length) throw Error("Empty paginated search");
      body = postbackFields(html);
      body.set("rdoSearchOption", "0");
      body.set("txtNameSearch", prefix);
      body.set("__EVENTTARGET", next.target);
      body.set("__EVENTARGUMENT", next.argument);
      page = next.page;
    }
    log(`Oregon search ${prefix}: ${page} pages`);
  }
  const officers = new Map(
    [...affiliations.values()].map((row) => [row.officerId, row]),
  );
  if (manifest.officers.some((entry) => !officers.has(entry.id)))
    throw Error("Unexpected saved officer identity");
  const agencyIds = new Set(
    [...affiliations.values()].map((row) => row.agencyId),
  );
  if (manifest.agencies.some((entry) => !agencyIds.has(entry.id)))
    throw Error("Unexpected saved agency identity");
  for (const [id, row] of officers) {
    const saved = previous?.officers.find((entry) => entry.id === id);
    if (
      saved &&
      (await completedPages(
        sourceDir,
        saved.employmentFiles,
        `officer-${id}-employment`,
        (html) => parseEmployment(html, id),
      )) &&
      (await completedPages(
        sourceDir,
        saved.certificateFiles,
        `officer-${id}-certificates`,
        (html) => parseCertificates(html, id),
      ))
    ) {
      log(`Oregon officer ${id}: reused validated employment and certificates`);
      continue;
    }
    manifest.officers = manifest.officers.filter((entry) => entry.id !== id);
    const entry = {
      id,
      employmentFiles: [] as string[],
      certificateFiles: [] as string[],
    };
    manifest.officers.push(entry);
    let html = await save(row.detailUrl, `officer-${id}-employment-1.html`);
    for (const tab of ["employment", "certificates"] as const) {
      if (tab === "certificates") {
        const body = postbackFields(html);
        body.set("__EVENTTARGET", "ctl00$ContentPlaceHolder1$mnuButtons");
        body.set("__EVENTARGUMENT", "1");
        html = await save(
          row.detailUrl,
          `officer-${id}-certificates-1.html`,
          body,
        );
      }
      let page = 1;
      const seen = new Set<string>();
      while (true) {
        const rows =
          tab === "employment"
            ? parseEmployment(html, id)
            : parseCertificates(html, id);
        const signature = JSON.stringify(rows);
        if (seen.has(signature)) throw Error(`Repeated ${tab} page for ${id}`);
        seen.add(signature);
        entry[
          tab === "employment" ? "employmentFiles" : "certificateFiles"
        ].push(`officer-${id}-${tab}-${page}.html`);
        await saveManifest();
        const next = nextPage(html, page);
        if (!next) break;
        if (!rows.length) throw Error(`Empty paginated ${tab}`);
        const body = postbackFields(html);
        body.set("__EVENTTARGET", next.target);
        body.set("__EVENTARGUMENT", next.argument);
        page = next.page;
        html = await save(
          row.detailUrl,
          `officer-${id}-${tab}-${page}.html`,
          body,
        );
      }
    }
    log(`Oregon officer ${id}: employment and certificates acquired`);
  }
  for (const id of new Set(
    [...affiliations.values()].map((row) => row.agencyId),
  )) {
    const url = new URL("AgencyList.aspx", BASE_URL);
    url.searchParams.set("Agcy", id);
    const file = `agency-${id}.html`;
    const saved = previous?.agencies.find((entry) => entry.id === id);
    if (saved && saved.file !== file)
      throw Error(`Invalid saved agency file for ${id}`);
    const html = saved
      ? await readFile(path.join(sourceDir, file), "utf8")
      : await save(url.href, file);
    const expectedNames = new Set(
      [...affiliations.values()]
        .filter((row) => row.agencyId === id)
        .map((row) => row.agencyName),
    );
    if (expectedNames.size !== 1)
      throw Error(`Conflicting agency names for ${id}`);
    const agency = parseAgency(html, [...expectedNames][0]!);
    if (
      agency &&
      [...affiliations.values()].some(
        (row) => row.agencyId === id && row.agencyName !== agency.name,
      )
    )
      throw Error(`Agency identity mismatch for ${id}: ${agency.name}`);
    if (!agency) log(`Oregon agency ${id}: No Data Found`);
    if (!saved) manifest.agencies.push({ id, file });
    await saveManifest();
  }
  manifest.complete = true;
  await saveManifest();
  log(
    `Oregon acquisition complete: prefixes ${prefixes.join(",")}; ${officers.size} officers; ${manifest.agencies.length} agencies`,
  );
}
export const acquire: SourceAcquire = async ({ sourceDir, env, logger }) => {
  const prefixes =
    env.OREGON_DPSST_PREFIXES === undefined
      ? Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
      : env.OREGON_DPSST_PREFIXES.split(",").map((s) => s.trim());
  await acquireOregon({
    sourceDir,
    prefixes,
    request: createClient({
      onSessionRenewal: () =>
        logger?.info(
          "Oregon public session expired; renewing through the search form",
        ),
    }),
    log: logger?.info.bind(logger),
  });
};
