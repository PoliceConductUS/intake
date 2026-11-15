import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../../../src/cli/transform/source-transform.js";
import { articleText, digest, type Article } from "./acquire.js";
import type { SourceRow } from "./spreadsheet.js";

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
      return sheet;
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
    const review = byUrl.get(article.url);
    if (article.error || !article.textFile || !article.bodyFile) {
      report.push({
        url: article.url,
        spreadsheets: references,
        status: "article-unavailable",
        error: article.error,
      });
      continue;
    }
    if (!review) {
      report.push({
        url: article.url,
        spreadsheets: references,
        status: "identity-unreviewed",
      });
      continue;
    }
    const body = await readFile(path.join(root, article.bodyFile));
    if (digest(body) !== article.sha256 || review.sha256 !== article.sha256)
      throw new Error(`Article digest changed: ${article.url}`);
    const { text } = articleText(body);
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
    ],
  };
};
