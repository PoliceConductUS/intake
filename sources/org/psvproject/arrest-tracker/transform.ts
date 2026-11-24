import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../../../src/cli/transform/source-transform.js";
import { stateAuthorityRecords } from "../../../lib/state-authority-findings.js";
import type { Finding } from "../../../../src/shared/data-annotations.js";
import { articleText, digest, type Article } from "./acquire.js";
import type { SourceRow } from "./spreadsheet.js";

const SOURCE = "org/psvproject/arrest-tracker";
const EMITTED = "emitted";
const ARTICLE_UNAVAILABLE = "article could not be retrieved";
const ARTICLE_NOT_REVIEWED = "article not reviewed";
const NO_OFFICER_IDENTITY = "article supports no officer identity";
const NO_KNOWN_OFFICER = "names no officer the database knows";
type Reason =
  | typeof ARTICLE_UNAVAILABLE
  | typeof ARTICLE_NOT_REVIEWED
  | typeof NO_OFFICER_IDENTITY
  | typeof NO_KNOWN_OFFICER;

const Review = z
  .object({
    url: z.string().url(),
    sha256: z.string(),
    officers: z.array(
      z
        .object({
          name: z.string().min(1),
          agency: z.string().min(1),
          state: z.string().regex(/^[A-Z]{2}$/),
          passages: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const transform: SourceTransform = async ({
  paths,
  state,
  data,
  logger,
}) => {
  if (!data?.resolveAgency)
    throw new Error("Article mapping requires agency and personnel resolvers");
  const sheets = paths.filter(
    (file) => path.basename(file) === "spreadsheet.json",
  );
  if (!sheets.length) throw new Error("Missing acquired spreadsheet.json");
  const articleFile = paths.find(
    (file) => path.basename(file) === "articles.json",
  );
  if (!articleFile) throw new Error("Missing acquired articles.json");
  const root = path.dirname(articleFile);
  const articles = JSON.parse(await readFile(articleFile, "utf8")) as Article[];
  const workbooks = await Promise.all(
    sheets.sort().map(async (file) => {
      const sheet = JSON.parse(await readFile(file, "utf8")) as {
        url: string;
        rows: SourceRow[];
      };
      if (!sheet.url) throw new Error("Missing spreadsheet URL");
      return {
        ...sheet,
        file: path.relative(root, file).split(path.sep).join("/"),
      };
    }),
  );
  const reviews = z
    .array(Review)
    .parse(
      JSON.parse(await readFile(path.join(root, "reviewed.json"), "utf8")),
    );
  const byUrl = new Map(reviews.map((review) => [review.url, review]));
  if (byUrl.size !== reviews.length)
    throw new Error("Duplicate reviewed article URL");
  const acquired = new Set(articles.map((article) => article.url));
  if (acquired.size !== articles.length)
    throw new Error(`${SOURCE}: articles.json repeats an article URL`);
  for (const review of reviews)
    if (!acquired.has(review.url))
      throw new Error(
        `${SOURCE}: reviewed.json entry is not in articles.json: ${review.url}`,
      );
  const outcomeOf = new Map<string, typeof EMITTED | Reason>();
  const links: EmittedRecords = {};
  const associations: EmittedRecords = {};
  const report: unknown[] = [];
  for (const article of articles) {
    const references = workbooks
      .map(({ url, rows }) => ({
        url,
        rows: rows
          .filter((row) => row.url === article.url)
          .map((row) => row.row),
      }))
      .filter((reference) => reference.rows.length);
    if (!references.length)
      throw new Error(
        `${SOURCE}: no workbook row cites the article ${article.url}`,
      );
    const review = byUrl.get(article.url);
    if (article.error || !article.textFile || !article.bodyFile) {
      report.push({
        url: article.url,
        spreadsheets: references,
        status: "article-unavailable",
        error: article.error,
      });
      outcomeOf.set(article.url, ARTICLE_UNAVAILABLE);
      continue;
    }
    if (!review) {
      report.push({
        url: article.url,
        spreadsheets: references,
        status: "identity-unreviewed",
      });
      outcomeOf.set(article.url, ARTICLE_NOT_REVIEWED);
      continue;
    }
    const body = await readFile(path.join(root, article.bodyFile));
    if (digest(body) !== article.sha256 || review.sha256 !== article.sha256)
      throw new Error(`Article digest changed: ${article.url}`);
    const { text } = articleText(body);
    outcomeOf.set(
      article.url,
      review.officers.length === 0 ? NO_OFFICER_IDENTITY : NO_KNOWN_OFFICER,
    );
    for (const officer of review.officers) {
      if (officer.passages.some((passage) => !text.includes(passage)))
        throw new Error(`Unsupported article passage: ${article.url}`);
      const agency = await data.resolveAgency({ agencyName: officer.agency });
      const stateMatches = agency?.location?.state === officer.state;
      const person =
        agency && stateMatches
          ? await data.resolvePersonnel({
              agencyId: agency.agencyId,
              personnelName: officer.name,
            })
          : null;
      report.push({
        url: article.url,
        spreadsheets: references,
        ...officer,
        status: !agency
          ? "agency-unresolved"
          : !stateMatches
            ? "agency-state-unverified"
            : !person
              ? "officer-unresolved"
              : "mapped",
        agencyPersonnelId: person?.agencyPersonnelId ?? null,
      });
      if (!person) continue;
      if (!article.title?.trim())
        throw new Error(`Article title unavailable: ${article.url}`);
      outcomeOf.set(article.url, EMITTED);
      const key = digest(article.url);
      const provenance = [
        ...references.map(
          (ref) => `${ref.url}; GENERAL rows ${ref.rows.join(", ")}`,
        ),
        `article SHA-256 ${article.sha256}`,
      ].join("; ");
      links[key] = {
        spec: {
          url: article.url,
          normalized_url: article.url.trim().replace(/\/+$/, "").toLowerCase(),
          title: article.title,
          source_name: new URL(article.url).hostname,
          notes: provenance,
        },
      };
      associations[`${key}|${person.agencyPersonnelId}`] = {
        spec: {
          coverage_link_id: key,
          agency_personnel_id: person.agencyPersonnelId,
          confidence: "named-in-article",
          notes: `${officer.passages.join("\n")}\n${provenance}`,
        },
      };
    }
    if (review.officers.length === 0)
      report.push({
        url: article.url,
        spreadsheets: references,
        status: "no-supported-officer-identity",
      });
  }
  const states = new Set<string>();
  const leftOut = new Map<string, Finding[]>();
  let read = 0;
  let emitted = 0;
  let reported = 0;
  const notSelected: Record<Reason, number> = {
    [ARTICLE_UNAVAILABLE]: 0,
    [ARTICLE_NOT_REVIEWED]: 0,
    [NO_OFFICER_IDENTITY]: 0,
    [NO_KNOWN_OFFICER]: 0,
  };
  for (const { file, url, rows } of workbooks) {
    for (const row of rows) {
      read += 1;
      if (row.state !== "") states.add(row.state);
      const place = `${file} GENERAL row ${row.row}`;
      if (row.url === null) {
        if (row.state === "")
          throw new Error(
            `${SOURCE}: ${place} has an empty link cell and names no state: ${JSON.stringify(row.name)}`,
          );
        leftOut.set(row.state, [
          ...(leftOut.get(row.state) ?? []),
          {
            code: "tracker-entry-without-link",
            type: "warning",
            field: "coverage_links",
            value: {
              name: row.name,
              title: row.title,
              state: row.state,
              category: row.category,
              outcome: row.outcome,
            },
            message: `The Police Sexual Violence Project arrest tracker lists ${row.name === "" ? "an officer" : row.name} in ${row.state} with no link to a news report, so the entry is not listed here.`,
            evidence: [{ workbook: url, sheet: "GENERAL", row: row.row }],
            source_namespace: SOURCE,
            source_record_id: `${file}#${row.row}`,
          },
        ]);
        reported += 1;
        continue;
      }
      const outcome = outcomeOf.get(row.url);
      if (outcome === undefined)
        throw new Error(
          `${SOURCE}: ${place} cites an article that is not in articles.json: ${row.url}`,
        );
      if (outcome === EMITTED) emitted += 1;
      else notSelected[outcome] += 1;
    }
  }
  await mkdir(state, { recursive: true });
  await writeFile(
    path.join(state, "mapping-report.json"),
    JSON.stringify(report, null, 2),
  );
  logger?.info(
    `${articles.length} articles; ${Object.keys(links).length} mapped articles; ${Object.keys(associations).length} officer associations; details: ${path.join(state, "mapping-report.json")}`,
  );
  return {
    artifacts: [
      { kind: "CoverageLinks", records: links },
      { kind: "CoverageLinkAgencyPersonnel", records: associations },
      {
        kind: "LicensingAuthorities",
        records: stateAuthorityRecords(states, leftOut),
      },
    ],
    accounting: [
      { input: "GENERAL rows", read, emitted, reported, notSelected },
    ],
  };
};
