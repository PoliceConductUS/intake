# Landing page search

## Overview

The scheduled workflow in this repository reads finalized Search Console query and landing-page rows and searches Google All organic results through SerpApi for up to five distinct terms per Chicago day. Each query has three parts from the highest-impression eligible profile: the quoted reported search term; every personnel-name variation, each quoted, joined with OR in one group; and the quoted agency name followed by the unquoted state. For multiple agencies it joins the distinct name/state alternatives with OR in one query. The first successful results page starts a 168-hour wait for that term, including when the search returns no results. Pagination and resumed searches share the original term slot. The first qualifying story is linked to the profile. It publishes full pages in the selected website release.

## Activation

After the website release and its public/private access checks have been verified, configure the repository variables and secrets listed in `.github/workflows/discover-news.yml`. Set the release function variable last to enable the scheduled job. The workflow runs at 7 a.m. Chicago time. A manual dispatch uses the same production publication path.

Use a Search Console service account with read access to the configured property, a free SerpApi key, and an inference endpoint that accepts OpenAI-compatible chat completions. The website infrastructure provides the private artifact bucket, site bucket, publisher role and release function. Keep query matches, saved bodies, selectors and paragraph records in private storage.

## Publisher ranks

Download a Common Crawl **domain** ranking snapshot. Build a compact JSON lookup for the publisher hostnames you want to rank. For each hostname, the names tried are the full hostname and then each parent suffix of two or more labels (`sources/lib/news-ranks.ts:domainNames`, not exported). The lookup keeps the harmonic centrality position of each of those names that the snapshot lists, and a publisher URL takes the rank of the first of its names in the lookup (`sources/lib/news-ranks.ts:domainRankFor`). No registered domain is calculated. Hosts without a rank use the remaining source-selection rules.

```sh
npx tsx sources/lib/news-ranks.ts domain-ranks.txt.gz news.example.org > domain-ranks.json
```

Store the JSON at `com/serpapi/landing-page-search/domain-ranks.json` in the private bucket. [Common Crawl ranking downloads](https://index.commoncrawl.org/web-graphs-index.html)

## Interface

- `intake.source.ts:source` - the `IntakeSource`; its only phase is `daily`, which calls `runDaily` with `dailyDeps` of the `env` it is given.
- `daily.ts:runDaily` - `(at: Date | undefined, deps) => Promise<void>`; one daily run.
- `daily.ts:dailyDeps` - `(env) => deps`; storage, release snapshot, Search Console, inference, search, article reader, publication, site origin, bucket and API key, built from `env`. `sources daily` passes an `env` whose `SERPAPI_KEY`, `SEARCH_CONSOLE_CREDENTIALS` and `NEWS_INFERENCE_API_KEY` are read from Parameter Store (`/policeconduct/secrets/<NAME>`); `SEARCH_CONSOLE_CREDENTIALS` is parsed as JSON.
- `discovery.ts:collectTraffic` - `(read, paths, origin) => Promise<Traffic[]>`; Search Console rows for known profile paths on the site origin, ordered by impressions.
- `discovery.ts:homepageRanking` - `(pairs, matches, newestByProfile) => { articleKey, clicks, position }[]`; at most 25 placements.
- `discovery.ts:searchFirst` - `(urls, inspect, limit = 10) => Promise<{ checked, match }>`; inspects distinct URLs in order until a match, `exhausted`, or the limit.
- `discovery.ts:pairKey` - `({ term, path }) => string`.
- `discovery.ts:shiftDate` - `(iso, days) => string`.
- Types: `discovery.ts:SearchRow`, `discovery.ts:QueryProfile`, `discovery.ts:Traffic`, `discovery.ts:Match`.
- `aliases.ts:newsNamespace` - this source's namespace, from `moduleSourceNamespace(import.meta.url)`.
- `aliases.ts:publisherRef` - `(url) => { namespace, sourceId }`; `sourceId` is the normalized coverage URL.
- `aliases.ts:resolveNewsAliases` - `(input) => NewsAliases`; validates an alias map and resolves each chain to its final target.
- `aliases.ts:readNewsAliases` - `(store, release) => Promise<NewsAliases>`; the `CoverageLink` aliases of a release.
- `aliases.ts:saveNewsAliases` - `(store, release, articles) => Promise<NewsAliases>`; adds each article's publisher URLs to the release alias file.
- `aliases.ts:recordKey` - `(ref, aliases = {}) => string`.
- `aliases.ts:articleKeys` - `(article, aliases) => Set<string>`.
- `aliases.ts:samePublisherGroup` - `(a, b, aliases) => boolean`.
- `aliases.ts:NewsAliases` - type; publisher URL to target publisher URL.
- `storage.ts:NewsStorage` - interface; `readJson`, `writeJson`, `readOriginal`, `readOverrideEtag`, `writeOverride`, `makeVisible`. A write returns `false` when its condition was not met.
- `storage.ts:createNewsStorage` - `() => NewsStorage`; backed by the `aws` CLI.
- `storage.ts:pageKey` - `(id, folder, path) => string`; the object key of a release page.
- `storage.ts:Stored` - type; a value with its ETag.
- `publication.ts:addReleaseArticle` - `(articles, incoming, aliases) => ReleaseArticle`; merges `incoming` into `articles` in place.
- `publication.ts:renderPage` - `(original, page, path, roster, aliases = {}) => string`; renders each page part into the release's original HTML.
- `publication.ts:publishPage` - `(storage, releaseId, path, roster, update, publicationKey?, aliases?) => Promise<void>`; merges the update into the page data, writes the override HTML, and makes the page visible.
- `publication.ts:publishDestinations` - `(storage, key, initial, roster) => Promise<Record<string, string>>`; publishes a batch under a checkpoint that a later run resumes; returns path to first-visible time.
- Types: `publication.ts:ReleaseArticle`, `publication.ts:Roster`, `publication.ts:Ranking`, `publication.ts:PageObject`, `publication.ts:PageUpdate`, `publication.ts:PublicationBatch`.
- `providers.ts:required` - `(name) => string`; a non-blank environment variable, trimmed; throws `<NAME> is required` otherwise. `daily.ts` and `storage.ts` both read their environment variables through it.
- `providers.ts:searchConsole` - `(property, credentials) => { latestWindow, rows, position }`; Search Console client.
- `providers.ts:newsResults` - `(query, start, apiKey) => Promise<{ response, urls, nextStart }>`; one SerpApi results page for the past week.
- `providers.ts:ProviderAllowance` - error class; the search allowance is unavailable or exhausted.
- `article-http.ts:readArticle` - `(url) => Promise<ArticleRead>`; the publisher's HTML, or an empty `html` with a `reason` it could not be read. A refused URL or redirect gives the reason "Publisher URL or redirect unavailable", and a request error gives its message as the reason. The type `ArticleRead` is not exported.

## Invariants

- `daily.ts:runDaily` - at most 5 term searches per Chicago day; a term is searched again only 168 hours after its last search; at most 10 URLs not already cached are read per search.
- `daily.ts:runDaily` - throws when the snapshot's roster bucket differs from `NEWS_PRIVATE_BUCKET`, when the roster is missing, and, on a release change, when a release baseline page is missing. It also throws:
  - "Missing roster for pending release <release>" when a pending batch belongs to another release whose `dynamic.json` is missing;
  - "Missing agency name or state for assignment <id>" when an agency of the profile's person has no name or no state;
  - "Missing agency assignments for <path>" when the profile's person has no assignment;
  - "Missing saved evidence for <other URL>, named by a paragraph of <URL>" when a paragraph record names a URL that has no `urls/` record;
  - "Missing article <article key> for the match of <term> on <path>" when a saved match names an article that is not in `state.articles`.
- `daily.ts:runDaily` - `state.json` is written with an ETag condition; a lost write throws "Another daily run advanced discovery". After each write it is read back, and a difference throws "Discovery state changed after save". Evidence, search page, review and paragraph record writes are conditional and throw when another writer got there first; for a paragraph record the error is "Paragraph evidence changed during search".
- `daily.ts:runDaily` - a saved search outcome is create-only; a different outcome under the same key throws.
- `daily.ts:runDaily` - a queued term whose profile path is no longer in the roster is closed with the outcome `missing_profile`.
- `daily.ts:runDaily` - in the search loop, `ProviderAllowance` is caught and ends the loop. A `NewsExtractionError` from `processNewsOccurrence` is caught for that one URL: it is saved in the URL's `urls/` record as `reason` with `extractionFailed: true`, and the search continues. Every other error is rethrown.
- `daily.ts:runDaily` - for each match whose article has a first-visible time on the profile page and no saved comparison, once the seventh day after that day is inside the Search Console window, it saves the Search Console position for the 7 days before and the 7 days after in `state.comparisons`.
- `daily.ts:runDaily` - new ids come from `createId` of `@paralleldrive/cuid2`.
- `daily.ts:activeSnapshot` (not exported) - throws when the release function reports an error.
- `discovery.ts:collectTraffic` - keeps a row only when its page URL has the site origin, no query string or hash, and a known path.
- `aliases.ts:resolveNewsAliases` - throws "Expected a CoverageLink alias map" when the input is not an object; every key and value must be a normalized `https://` publisher URL; a cycle throws.
- `aliases.ts:readNewsAliases` - throws when the release has no alias file.
- `aliases.ts:recordKey` - throws when the reference has neither a namespace and source id nor a canonical id.
- `storage.ts:pageKey` - throws on an invalid release id or a page path that is not a canonical `/…/` path.
- `storage.ts:createNewsStorage` - every write is conditional (`--if-none-match *` or `--if-match <etag>`); a missing release original throws; `makeVisible` throws when the release function fails or its result has no `invalidationId`.
- `storage.ts:createNewsStorage` - `NEWS_PRIVATE_BUCKET`, `NEWS_SITE_BUCKET`, `NEWS_RELEASE_FUNCTION` and `NEWS_DISTRIBUTION_ID` are read through `providers.ts:required`, so an unset or blank value throws `<NAME> is required`.
- `publication.ts:mergeArticle` (not exported) - conflicting canonical ids for one coverage relationship throw; `publication.ts:addReleaseArticle` throws on conflicting canonical ids for one article.
- `publication.ts:mergePage` (not exported) - an update with articles or a ranking requires the page's `news` part; a ranking replaces the saved one only when its `windowEnd` is not earlier.
- `publication.ts:storyAt` (not exported) - on a path other than `/`, an article needs a roster assignment whose person or agency page is that path. It also throws on an unknown assignment, an assignment whose person or agency is not in the roster, a relationship whose supporting source is not among the article's occurrences, and a missing preferred source.
- `publication.ts:renderPage` - throws "Missing page element <selector>" when a required element is absent and "Missing page text <name>" when a `data-part-text` slot has no string value.
- `publication.ts:renderNews` (not exported) - a ranked article missing from the page, a missing item template, and a non-http(s) article URL throw.
- `publication.ts:publishPage` - throws when the release page data is missing; retries the data and override writes until the conditional write succeeds.
- `publication.ts:publishDestinations` - the saved checkpoint's batch drives the publication; a first-visible time already recorded for a path is not overwritten. When the checkpoint's release differs from `initial.releaseId`, the roster is read from `builds/<release>/data/dynamic.json`, and a missing one throws "Missing pinned release roster". A checkpoint that cannot be read back throws "Missing publication checkpoint: <key>".
- `providers.ts:newsResults` - throws `ProviderAllowance` unless the SerpApi account is on the free plan with searches left and is under its hourly limit, and on HTTP 429; an invalid next-page offset throws. A results page with an `error` that is not a no-results message throws "Google All search returned an error".
- `providers.ts:json` (not exported) - any response that is not OK from Google authentication, Search Console or SerpApi throws `<service> returned HTTP <status>`.
- `providers.ts:searchConsole` - `latestWindow` throws when Search Console supplies no reporting dates.
- `article-http.ts:readPublicArticle` (not exported) - refuses a URL that is not http(s), has credentials or an explicit port, or resolves to a non-public address (`article-http.ts:isPublic`, not exported). It makes at most 8 requests, so it follows at most 7 redirects; an eighth redirect is refused.
- `article-http.ts:readPublicArticle` - each request times out after 20 seconds. A response whose content type is not HTML gives no body and the reason "Non-HTML response (HTTP <status>)". An HTML response with a status other than 200 gives the body and the reason "Publisher HTTP <status>".

## Side Effects

- `daily.ts:dailyDeps` - reads `SEARCH_CONSOLE_PROPERTY`, `SEARCH_CONSOLE_CREDENTIALS`, `NEWS_SITE_ORIGIN`, `NEWS_PRIVATE_BUCKET` and `SERPAPI_KEY` from `env` and passes `env` to `createNewsInference`. With the `env` from `sources daily`, the first read of each of those three keys runs `aws ssm get-parameter`; `NEWS_INFERENCE_API_KEY` is read at the first inference call. `createNewsStorage` still reads `NEWS_PRIVATE_BUCKET` and `NEWS_SITE_BUCKET` from `process.env`.
- `daily.ts:activeSnapshot` (not exported) - runs `aws lambda invoke` on the function named by `NEWS_RELEASE_FUNCTION`, using a temporary directory.
- `daily.ts:runDaily` - reads and writes JSON objects in the private bucket under this source's namespace (`state.json`, `urls/`, `searches/`, `review/`, `outcomes/`, `batches/`, and one paragraph record per paragraph at `<paragraph hash>/index.json`), reads `domain-ranks.json`, the roster, the release alias file (`builds/<release>/data/alias.json`), and the release page data; for a pending batch of another release it reads `builds/<release>/data/dynamic.json`; calls the inference endpoint; reads Search Console positions through `consoleApi.position`; publishes through `publishDestinations`.
- `providers.ts:searchConsole` - POST to `https://oauth2.googleapis.com/token` and to the Search Console `searchAnalytics/query` endpoint.
- `providers.ts:newsResults` - GET `https://serpapi.com/account.json` and `https://serpapi.com/search.json` with the API key as a query parameter.
- `article-http.ts:readArticle` - HTTP(S) GET of the publisher URL and its redirects, with a DNS lookup.
- `storage.ts:aws` (not exported) - runs the `aws` CLI as a subprocess: `s3api get-object`, `put-object` and `head-object` on the private and site buckets, `lambda invoke`, and `cloudfront wait invalidation-completed`; `storage.ts:withFile` (not exported) uses a temporary directory.
- `storage.ts:createNewsStorage` - reads `NEWS_PRIVATE_BUCKET`, `NEWS_SITE_BUCKET`, `NEWS_RELEASE_FUNCTION` and `NEWS_DISTRIBUTION_ID` from the environment.
- `publication.ts:publishPage` - through `NewsStorage`: writes the page data JSON and the override HTML, then calls `makeVisible`.
- `publication.ts:publishDestinations` - through `NewsStorage`: creates and updates the checkpoint at the batch key, saves the release aliases, and reads `builds/<release>/data/dynamic.json` when the checkpoint's release differs from `initial.releaseId`.
- `aliases.ts:saveNewsAliases` - reads and conditionally writes `builds/<release>/data/alias.json`.

## Verification

- Run: `npx vitest run test/sources/news`
