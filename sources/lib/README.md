# sources/lib

## Overview

Code shared by intake sources. It holds eight modules: the civil-case ID and
court token helpers, slug and person-name tests for civil defendants, news
article extraction, matching and merging, the news inference client, Common
Crawl domain-rank lookup, personnel name variants, the `LicensingAuthorities`
records that carry a source's findings by state, and a YouTube Data API v3
client built over injected fetchers. No module here reads `process.env`,
writes to disk, or reaches the database.

## Interface

### civil-case-id.ts

- `civil-case-id.ts:COURT_ID_BY_NAME` - `Record<string, string>` from 13 court
  names to CourtListener `court_id` tokens.
- `civil-case-id.ts:courtTokenFromName` - `(courtName) => string`. The mapped
  token for the trimmed name, otherwise `slugify(name)`.
- `civil-case-id.ts:normalizeDocketNumber` - `(raw) => string`. Trims,
  lower-cases, and removes all whitespace.
- `civil-case-id.ts:civilCaseNaturalId` - `(courtToken, docketNumber) => string`.
  Returns `<courtToken>:<normalized docket number>`.

### civil-defendants.ts

- `civil-defendants.ts:slugify` - `(value) => string`. Lower-cases, replaces
  each run of characters outside `[a-z0-9]` with `-`, and strips leading and
  trailing `-`.
- `civil-defendants.ts:isPersonName` - `(name) => boolean`. True when the
  name, with whitespace collapsed, is not empty, does not match the
  institution pattern, does not match the placeholder pattern, and starts with
  a capital letter, then lower-case letters, a period or nothing, then a space
  and a capital letter (`John Smith`, `J. Smith`, `J Smith`).

### news.ts

- `news.ts:NewsExtractionError` - `Error` subclass thrown by
  `processNewsOccurrence` for a missing title, an unmatched body selector, or
  an empty body.
- `news.ts:SourceRef`, `news.ts:NewsAssignment`, `news.ts:NewsOccurrence`,
  `news.ts:ReleaseIdentity`, `news.ts:ReleaseRelationship`,
  `news.ts:ReleaseArticle`, `news.ts:NewsInference` - types re-exported from
  [`src/shared/release-news.ts`](../../src/shared/release-news.ts).
- `news.ts:normalizedParagraph` - `(text) => string`. NFKC-normalizes,
  lower-cases, removes punctuation, and collapses whitespace.
- `news.ts:bodyNameMatcher` - `(body) => (name) => boolean`. Whole-token match
  of a normalized name inside the normalized body.
- `news.ts:chicagoDate` - `(now: Date) => string`. `YYYY-MM-DD` in
  `America/Chicago`.
- `news.ts:eligibleNewsDate` - `(publishedAt, now) => boolean`. True for a real
  calendar date that is not after today's Chicago date and not more than 6
  days before it.
- `news.ts:processNewsOccurrence` -
  `({ html, url, correctedSelector?, domainRank?, assignments, infer }) => Promise<NewsOccurrence>`.
  Extracts the title, publication date, body paragraphs with their hashes and
  publisher attribution, and calls `infer` for the assignments whose names
  appear in a paragraph.
- `news.ts:selectPreferredOccurrence` - `(occurrences) => NewsOccurrence`.
  Orders by cited original first, then lower `domainRank`, then earlier
  `publishedAt`, then `url`.
- `news.ts:matchingArticles` - `(occurrence, articles, sameSource?) => ReleaseArticle[]`.
  Articles that share a source, a normalized URL, or enough paragraph hashes
  with the occurrence.
- `news.ts:selectSupportedOccurrence` - `(relationship, occurrences) => NewsOccurrence | undefined`.
  The preferred occurrence among those that qualify. An occurrence with a
  `support` list qualifies when the list names the relationship's
  `agencyPersonnelId`. An occurrence with `support === undefined` qualifies
  when its `url` equals `relationship.occurrenceUrl`.
- `news.ts:mergeNewsOccurrence` -
  `(current, occurrence, namespace, mint, sameSource?) => { articles, article?, ambiguous, needsCorrection }`.
  Merges one occurrence into zero or one matching article.
- `news.ts:mergeCurrentNews` -
  `(current, occurrence, { now, namespace, mint, read, known?, sameSource?, summarize? }) => Promise<{ articles, article?, ambiguous, needsCorrection }>`.
  Merges an occurrence with its related known occurrences and its cited
  original, and applies the date eligibility rule.

### news-inference.ts

- `news-inference.ts:createNewsInference` - `(env) => NewsInference`. Returns a
  function `(body, candidates, paragraphs = [body])` that posts the article
  paragraphs and candidates to `env.NEWS_INFERENCE_URL` and returns the
  validated `{ summary, support: [{ assignmentId, paragraphIndexes }] }`.

### news-ranks.ts

- `news-ranks.ts:domainRankFor` - `(url, ranks) => number | undefined`. The
  rank of the most specific domain suffix of the URL's host that is a key of
  `ranks`.
- `news-ranks.ts:readDomainRanks` - `(lines, hosts) => Promise<Record<string, number>>`.
  Reads the lines of a Common Crawl domain ranking snapshot and returns the
  ranks for the domain suffixes of `hosts`.

### personnel-names.ts

- `personnel-names.ts:PersonnelNameFields` - type
  `{ name, firstName?, middleName?, lastName?, suffix? }`.
- `personnel-names.ts:personnelSearchNames` - `(person) => string[]`. The
  trimmed `name` plus the first, middle or initials, last and suffix
  combinations, without duplicates. A suffix at the end of `lastName` (`Jr`,
  `Sr`, `II`, `III`, `IV` or `V`, in any case) is split off the last name and
  is used as the suffix when `suffix` is empty.
- `personnel-names.ts:personnelNameEvidence` -
  `(variants, paragraphs) => { name, paragraphHashes }[]`. For each name
  variant that `bodyNameMatcher` finds in at least one paragraph, the hashes
  of the matching paragraphs. A variant that matches no paragraph is left out
  of the result.

### state-authority-findings.ts

- `state-authority-findings.ts:stateAuthorityRecords` -
  `(states: Iterable<string>, findingsByState: ReadonlyMap<string, Finding[]>) => EmittedRecords`.
  The `LicensingAuthorities` records of a source that is not a licensing
  source: one partial update for each state in `states`, keyed by the
  lower-case state code, with
  `metadata: { action: "PATCH", selector: { location_path: { path: "/<code>/" } }, defects }`
  and `spec: {}`. `defects` holds the state's findings and is an empty list
  when the state has none.

### youtube.ts

- `youtube.ts:YoutubeSearchHit` - type
  `{ videoId, title, description, publishedAt, channelId, url }`.
- `youtube.ts:DateWindow` - type `{ publishedAfter?, publishedBefore? }`.
- `youtube.ts:YoutubeApi` - type with `resolveChannelId(handle)` and
  `searchChannelVideos(channelId, query, window?)`.
- `youtube.ts:createYoutubeApi` - `({ fetchJson }) => YoutubeApi`. Builds the
  client over the injected fetcher.
- `youtube.ts:YoutubeQuotaError` - `Error` subclass. Nothing in this folder
  throws it.
- `youtube.ts:isQuotaExhaustedBody` - `(body) => boolean`. True for
  `error.status === "RESOURCE_EXHAUSTED"` or an error reason of
  `quotaExceeded`, `dailyLimitExceeded`, `rateLimitExceeded` or
  `userRateLimitExceeded`.
- `youtube.ts:quotaResetHint` - `(body, now) => string`. A daily-quota or
  per-minute hint that includes the next `America/Los_Angeles` midnight.
- `youtube.ts:videoUrl` - `(videoId) => string`.
  `https://www.youtube.com/watch?v=<videoId>`.

## Invariants

- `civil-case-id.ts:civilCaseNaturalId` - the ID format is
  `<courtToken>:<docket number>`. The docket number is normalized; the court
  token is used as passed.
- `civil-case-id.ts:courtTokenFromName` - the lookup in `COURT_ID_BY_NAME` is
  an exact, case-sensitive match on the trimmed name; an unmapped name does
  not throw.
- `civil-defendants.ts:slugify` - the output holds only `[a-z0-9-]` with no
  leading or trailing hyphen, and is empty when the input has no such
  character.
- `civil-defendants.ts:isPersonName` - the placeholder pattern
  (`PLACEHOLDER`, not exported) rejects `John` or `Jane` followed by `Doe` or
  `Roe`, and also any name that holds the word `doe`, `does`, `roe` or `roes`,
  in any case.
- `news.ts:processNewsOccurrence` - throws `NewsExtractionError` with
  `Article has no source title: <url>`,
  `Body selector did not match at <url>: <selector>` or
  `Selected body is empty at <url>`.
- `news.ts:processNewsOccurrence` - throws
  `Inference returned unsupported assignment or passage for <url>` when an
  inference support item names an assignment that is not a candidate, has an
  empty `paragraphIndexes` list, or holds an index that is not an integer or
  is out of range.
- `news.ts:processNewsOccurrence` - `infer` is called only when at least one
  assignment name appears in a paragraph; otherwise the result has
  `summary: null` and `support: []`.
- `news.ts:processNewsOccurrence` - a paragraph hash is the sha256 hex of
  `normalizedParagraph(text)`.
- `news.ts:processNewsOccurrence` - the result has
  `uncertainty: "No distinct article paragraphs or main article container identified."`
  when the selector used is `body` or the selected element holds no `<p>`
  text; otherwise it has no `uncertainty` key.
- `news.ts:eligibleNewsDate` - the window is fixed: the published date is at
  most today's `America/Chicago` date and at least 6 days before it. A null or
  malformed date is not eligible.
- `news.ts:selectPreferredOccurrence` - throws
  `Article has no source occurrences.` on an empty list. The order is
  deterministic and the input array is not changed.
- `news.ts:matchingArticles` - the paragraph-overlap threshold is fixed at 0.3
  of the smaller hash set.
- `news.ts:mergeNewsOccurrence` - when more than one article matches, nothing
  is merged and the matches are returned in `ambiguous`. When no article
  matches and the occurrence has no `support`, no article is created.
- `news.ts:mergeNewsOccurrence` - an existing article keeps its identity
  fields. A new article takes `occurrence.sourceId ?? mint()`, and a new
  relationship takes `mint()`. `current` is not changed.
- `news.ts:mergeNewsOccurrence` - each existing relationship is handled by its
  `occurrenceUrl` and `selectSupportedOccurrence`:
  - `occurrenceUrl === null`: the relationship is left as it is.
  - No supporting occurrence: it gets `needsCorrection = true` and its
    `agencyPersonnelId` is reported in `needsCorrection`.
  - A supporting occurrence: its `needsCorrection` key is deleted and its
    `occurrenceUrl` is set to the URL of that occurrence.
- `news.ts:mergeNewsOccurrence` - a relationship is added for each `support`
  item of the occurrence whose `assignmentId` has no relationship yet, with
  `occurrenceUrl` set to the occurrence URL, `confidence: "documented"` and
  `notes: null`.
- `news.ts:mergeCurrentNews` - outcomes other than the merged result:
  - Returns the first `mergeNewsOccurrence` result as it is when that merge
    yields no article. That result can carry `ambiguous`.
  - Returns `current` with empty `ambiguous` and `needsCorrection` when the
    cited original cannot be read, does not match the merged article, or is
    not eligible by date, or when the occurrence or the preferred occurrence
    is not eligible by date.
  - Returns `current` with `ambiguous` filled when the merge of a related
    occurrence is ambiguous.
- `news-inference.ts:createNewsInference` - the returned function throws
  `NEWS_INFERENCE_URL and NEWS_INFERENCE_MODEL are required to analyze news.`
  when either is missing, and `News inference returned HTTP <status>` on a
  response that is not ok.
- `news-inference.ts:createNewsInference` - the response is validated with a
  zod schema: `summary` is a non-empty string and each `support` entry has an
  `assignmentId` and a non-empty list of non-negative integer
  `paragraphIndexes`. Content that is not JSON throws the `JSON.parse` error
  and content that fails the schema throws the zod error; a response with no
  `choices[0].message.content` is parsed as `null` and fails the schema.
- `news-ranks.ts:readDomainRanks` - throws
  `Expected a Common Crawl domain ranking snapshot` unless the first line has
  `#harmonicc_pos` in field 0 and `#host_rev` in field 4, and
  `Invalid Common Crawl rank` unless the rank of a wanted domain is a safe
  integer of 1 or more. A wanted domain that is absent from the snapshot is
  left out of the result.
- `news-ranks.ts` (module-level block) - when run as the entry script it
  throws `Supply a downloaded domain-ranks.txt.gz file and publisher hostnames`
  unless the arguments hold a snapshot path and at least one host name.
- `news-ranks.ts:domainRankFor` - only own keys of `ranks` match
  (`Object.hasOwn`); the bare top-level domain is never tried.
- `personnel-names.ts:personnelSearchNames` - when `firstName` or `lastName`
  is missing the result is the trimmed `name` only; otherwise the variants are
  sorted longest first.
- `state-authority-findings.ts:stateAuthorityRecords` - a state code is read
  in any letter case and emitted once. It throws
  `State is not a two-letter code: <value>` for a state in either argument
  that is not two letters, and
  `Findings for a state that was not processed: <code>` when `findingsByState`
  names a state that `states` does not.
- `youtube.ts:createYoutubeApi` - the API base is
  `https://www.googleapis.com/youtube/v3`; a search sends `part=snippet`,
  `type=video`, `maxResults=50` and `order=date`, and requests the next page
  with `pageToken` until a response has no `nextPageToken`. A repeated
  `videoId` is returned once.
- `youtube.ts:createYoutubeApi` - a search throws when a response has no
  `items` list, when a hit has no `videoId`, and when the search has returned
  500 hits (`youtube.ts:CHANNEL_SEARCH_VIDEO_LIMIT`, not exported), the most
  the API returns for a search with `channelId` and `type=video`.
- `youtube.ts:createYoutubeApi` - the client does no quota detection; errors
  from the injected `fetchJson` are not caught.

## Side Effects

- `news-inference.ts:createNewsInference` - network: `fetch` POST to
  `env.NEWS_INFERENCE_URL`, with `Authorization: Bearer` only when
  `env.NEWS_INFERENCE_API_KEY` is set. It reads `NEWS_INFERENCE_URL`,
  `NEWS_INFERENCE_MODEL` and `NEWS_INFERENCE_API_KEY` from the `env` record
  passed in.
- `news.ts:processNewsOccurrence` - reads the clock for `observedAt` and calls
  the injected `infer`.
- `news.ts:mergeCurrentNews` - calls the injected `options.read`,
  `options.mint` and `options.summarize`. It uses `options.now` and does not
  read the clock.
- `news.ts:mergeNewsOccurrence` - calls the injected `mint`.
- `youtube.ts:createYoutubeApi` - network only through the injected
  `fetchJson`: `/channels` and `/search` under
  `https://www.googleapis.com/youtube/v3`. It never requests captions. No API
  key is added in this file.
- `news-ranks.ts` (module-level block) - when run as the entry script it reads
  `process.argv`, reads the gzipped snapshot file from disk, and prints the
  ranks as JSON with `console.log`. `news-ranks.ts:readDomainRanks` consumes
  the lines it is given and does no IO of its own.
- `civil-case-id.ts`, `civil-defendants.ts`, `personnel-names.ts`,
  `state-authority-findings.ts` and the
  other exports of `news.ts`, `news-ranks.ts` and `youtube.ts` have no side
  effects.

## Verification

- Run:
  `npx vitest run test/sources/lib test/sources/civil-defendants.test.ts test/sources/news`
