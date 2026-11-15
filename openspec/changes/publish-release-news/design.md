# Publish news between website builds

## Context

Intake is the data-import application. It already records coverage links and their officer-at-agency assignments. The website builds agency and personnel pages from those records. Today the coverage component omits the section when there are no links. The website also has a separate editorial news collection. This design concerns linked source articles.

The current production router reads from the site bucket root. Preview requests use a prefix. A promotion script contains a release pointer, but the checked-in router does not read it. The release layout and override selection below require implementation. An override belongs to exactly one release and one canonical path.

## Discovery and evidence

Schedule the Intake news-discovery GitHub Action for 7:00 a.m. each day in `America/Chicago`. It writes discovery evidence, structured release data and full HTML overrides. Landing-page-search writes its results to the selected website release. It is independent of the automatic database reset sources.

The daily Intake Action reads organic Google Search impressions, clicks and average position grouped by query and landing page. For the latest seven finalized Search Console reporting days, advance the Search Analytics request’s startRow through successive pages until a request returns no rows. Finish reading all available rows before ranking any pairs or starting article searches. Keep a pair only when its exact landing path identifies an individual personnel profile in the production release snapshot. Apply this filter before ordering by impressions or aggregating homepage clicks. The personnel directory (`/personnel/`), state pages such as `/tx/`, and agency pages are outside that input. Search the eligible pairs in descending order of impressions using the quoted original reported term, at least one quoted roster-name variation, and the quoted agency name and stored state from the profile’s assignments. For multiple distinct agency/state pairs, use one grouped OR query. When the same query appears for two profiles, each pair has its own impression and click counts. Daily uses SerpApi’s Google All organic results (`engine=google`, `tbs=qdr:w`) under `com/serpapi/landing-page-search`. Walk the ranked pairs and select at most five distinct eligible Search Console terms per America/Chicago day across all runs. The first eligible pair for a term supplies its target profile. Keep its original reported term as the history key across profiles and website releases. Distinct reported spellings remain distinct terms.

Keep the term and the time of its first successful results page in private Intake state, including empty results. A new search for that term becomes eligible after 168 elapsed hours. Terms skipped for cooldown or unavailable allowance leave room for other eligible terms when allowance permits. Resume an interrupted search from its checkpoint. Further result pages use provider allowance but occupy the same daily term slot. Apply these limits only to new discovery. Refresh homepage ranking from all eligible traffic and existing matches. The full roster sweep is outside this change.

Limit the daily Action to the search date and the six preceding calendar dates in `America/Chicago`. Request past-week results and check the source publication date before accepting a match, including a cached result. When a story has multiple copies, use its preferred source’s publication date to check its age. A recent update or republication of an older story does not qualify it as current news.

Skip URLs with no readable or saved article body. Read results in ranked order, reusing corrected saved article bodies when available. Count newly checked URLs separately from provider requests. Stop each targeted search at the first qualifying article or ten new URLs, subject to the free provider allowance. Link the first qualifying article to that landing page. A known qualifying URL ends that search even when zero new URLs were needed. Finish processing all supported matches in the article and update the URL and paragraph data before moving to the next search. For the Action, completion also includes publication to every affected destination as described below.

The source text must name and concern the officer on the profile and an agency where that officer has an assignment. Names can occur in different paragraphs. Daily checks only exact roster-name variations in the extracted paragraphs, case-insensitively and longest first. The search term and agency text cannot establish personnel identity. Inference evaluates the named person’s assignment in context. Keep the roster fields, variations tried, matching paragraph references and publisher evidence privately for replay. Use the whole story to identify other supported pairs. Keep only those pairs.

Each URL record keeps its selector, selected body, paragraph hashes and publication metadata. If extraction is uncertain, save the best selected body and the reason. Later matching uses a corrected selection when supplied. A dedicated cache bucket is preferred. For each normalized paragraph, `<hash>/index.json` stores the normalized text and occurrences. Associate agency and personnel evidence with the particular occurrence. This preserves context when identical text appears in different articles.

Normalize Unicode and whitespace and ignore capitalization and punctuation for hashing. Compare sets of distinct main-body hashes. Two articles are copies when the intersection count divided by the smaller set size is at least 0.30. Three shared distinct paragraphs out of ten qualify. Two out of ten are below the threshold. Keep an undated occurrence as evidence and continue searching for a dated qualifying article. It becomes eligible for discovery when a source publication date places the story within the search window. Show the source title and date, using Open Graph metadata when available. Summarize the full extracted main body. Keep source wording and evidence distinct from the site's own summary.

## One article across preferred URLs

Daily identifies each publisher occurrence with the source namespace `com/serpapi/landing-page-search` and the normalized publisher URL as its source ID. Keep the publisher's actual link for readers. Record each occurrence's source pair in private JSON. References may use any source pair belonging to that story. The displayed article carries the source pair of the displayed occurrence in HTML. Each article-to-assignment relationship retains its own persistent source identity.

Daily writes `builds/{release-id}/data/alias.json` in private release storage. The outer keys are Intake record kinds. Inside `CoverageLink`, a duplicate’s normalized publisher URL maps to another normalized publisher URL for the same story within the `com/serpapi/landing-page-search` namespace. Daily preserves mappings for other kinds, and resolves article aliases within `CoverageLink`.

```json
{
  "CoverageLink": {
    "https://copy.example/story": "https://publisher.example/story"
  }
}
```

This entry groups the two URL source IDs. A release without aliases starts with `{"CoverageLink":{}}`. Daily merges confirmed aliases when saving the release.

Daily follows URL aliases when updating saved articles and preserves their source identities across searches.

Intake’s existing coverage resolver ordinarily uses normalized URL as canonical identity. Prefer explicit original-publisher attribution and then the proposed free Common Crawl domain rank. Update the preferred URL on the existing record.

An article links to an officer’s assignment at an agency (`AgencyPersonnel`). Build each agency’s news list from the articles linked through its personnel assignments. Include each article once per agency. If a syndicated copy supplies the link for an assignment, that link also supplies the agency entry derived from that assignment.

For an officer’s page, use a source occurrence that supports the officer’s association. If the preferred copy omits the supporting passage, link to the evidence-bearing occurrence and use that occurrence’s source metadata and full body for its entry. If corrected extraction removes the last support for an already published news association, flag the association for manual correction. Preserve associations independently supported elsewhere. If a copy overlaps two already established article IDs, retain both and report the ambiguity for resolution.

## Release and page object

The build writes original pages in `builds/{release-id}/static/`. The fixed agency and personnel snapshot lives at `builds/{release-id}/data/dynamic.json`. Saved homepage parts live at `data/index.json` and its full replacement at `override/index.html` within that release. Other canonical pages use their corresponding paths. Build-time data supplies agency, personnel and path identities.

Saved records, including page data and assignment notes, and extracted article bodies are private to the services that discover, render and import coverage. Production and preview serve the rendered pages with their source links, summaries and namespaced IDs. Visitors cannot retrieve the underlying records or extracted bodies through either host.

The [alternatives in the concept brief](brainstorm.md) explain the choice to retain structured data and regenerate from the original. Each saved page object is keyed by page part. Each entry identifies the target, where in the original page to get its template or which template to use, and the data to render. The following example illustrates the object shape. Field names and template representation are proposed.

```json
{
  "news": {
    "target": "[data-page-part='news']",
    "template": { "fromOriginal": "template[data-template='coverage-item']" },
    "data": { "articles": [] }
  }
}
```

Intake's page publisher supplies the targeting and template instructions. Article fields supply values for the template. Render source titles and summaries as text using the same escaping as the ordinary Astro view. News is the first consumer. The original build provides an insertion target and item markup even on a page with zero stories. Each target's saved news data covers all its applicable articles, including coverage already present at build time. At build time, obtain the underlying coverage-link and coverage-link-agency-personnel rows from the same database as the ordinary loader. Preserve the normalized URL, original record and relationship IDs, agency-personnel ID, confidence and any relationship notes in the structured records. The current view of officer names and slugs alone cannot supply those values. Page destinations refer to the same stable identities. An explicit template can be used when the entry does not select one from the original. The design supports changing any part of any original page.

1. Pin the release and canonical path. Load the complete saved page object. For an initial news update, include the release's existing coverage in the baseline.
2. Merge Action-created articles and their relationship records using each record’s persisted namespace and source ID. Retain previously saved parts, including unrelated ones. Persist that object. Keep the targeted search at its current acquisition position until publication completes for every destination.
3. Read a fresh copy of this release's original HTML. Resolve each entry's target and template relative to the original or use its specified template. Render the complete object. Agency and personnel pages retain the existing newest-first ordering. The homepage uses the seven-day organic-click ranking.
4. Write the full HTML under `override/` and make the updated page visible at its canonical URL. On retry after a data write, render from the saved data even if the article itself is already recorded. If a write to the officer page succeeds and the agency page fails, the next acquisition resumes the same search. Retain its matched article’s namespace and source ID, release and full destination list in the existing source checkpoint. Replay all destinations from their latest saved data, including pages already written. Advance only when the full set has been rendered and made visible. A concurrent update must reread and merge the latest data before publishing; a stale HTML write must not become the final served version.

For example, if the original page contains A and two runs find B and C, the regenerated page contains all three once. A later change to another part retains that news list. Full-page regeneration reads the original HTML and all current entries each time.

### Search position after publication

Record when new coverage first appears on the individual profile. For each matched query and profile, compare the average position reported by Search Console for the seven complete reporting days immediately before and the seven complete reporting days immediately after publication. Exclude the publication day. When either period has no reported position for that pair, leave the comparison unavailable. Retain the period dates alongside the two values so the change can be interpreted. The comparison describes observed movement for that exact pair. It does not establish what caused the movement.

### Homepage ranking

Search Console records organic clicks for each (personnel landing page, search term) pair. For each eligible profile, sum the seven-day clicks from its distinct matched pairs once each. Select each profile’s newest qualifying story by comparing the publication dates of the stories’ preferred sources. Display the selected story with the preferred source’s date, title and link, including when several profiles select it. Changing the displayed story or its preferred URL leaves the measured pairs and their counts intact. If several profiles select the same story, show it once and combine those profiles’ totals for homepage ordering. Show up to 25 distinct stories.

## Forms and routing

The deployment assigns an identity to each built website release. Each form embeds that value. The shared submission helper includes `releaseId` after invoking the ordinary or custom payload builder. The environment-specific Forms API keeps it in the stored submission. A form opened before deployment retains its original value. Preview release identity and destination remain separate even when the commit also appears in production.

The production API and public router must agree on which website release the production host serves. The API returns that release ID together with its built roster. For a request within a selected release, route to the full override when published for that path and otherwise use the original. Refresh the canonical page on first publication and on subsequent override changes, including when the previously cached response came from the original. Preserve separate production and preview routing. Production stays on the selected release throughout publication.

The daily worker publishes to the selected release and retains its private evidence there.

## Review and rollout

Exercise daily discovery and the ordinary build. For the website, test empty and populated regions, subsequent changes to a different part, an updated preferred URL, two overlapping writes and a retry after only one of two destination pages was published. Check both destinations before advancing the checkpoint. Test an old open form, a custom form payload and a preview built from the production commit. Verify the router serves the release returned by the API and refreshes previously visited originals and overrides. Render a title containing literal HTML as text. A later authorized release provides the snapshot, markup and API before starting the hosted Action.

## Open design decisions

Technical details still to select include the source of valid form-release IDs, release routing and cache refresh implementation, storage and coordination for evidence and page writes, the inference runtime, template representation, and rank ties. This design makes no change to civil-case joins or stale-case withdrawal.
