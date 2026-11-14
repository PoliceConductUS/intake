## ADDED Requirements

### Requirement: Regenerate a page from its original release and saved parts

The publisher SHALL merge new data into the selected release's saved object, apply every keyed part to the original release HTML and publish a complete replacement at the corresponding path. Each entry SHALL identify its target, a template from the original page or the template to use, and its rendering data.

#### Scenario: Second update changes a different part

- **WHEN** one part already has a saved update and another part receives new data
- **THEN** the new full document includes both updates and all unaffected original content

#### Scenario: News appears in a previously empty section

- **WHEN** the selected release's original news section has no stories and a qualifying article is added
- **THEN** the resulting page renders the article once at the intended location

#### Scenario: A better copy appears

- **WHEN** the preferred URL of an already matched article changes
- **THEN** the article keeps its ID and associated assignments, and its updated fields appear in each applicable page

### Requirement: Keep saved records and extracted article bodies private

Access to saved records and extracted article bodies SHALL be limited to the services that discover, render and import coverage.

#### Scenario: A visitor requests the data behind a published story

- **WHEN** a visitor requests saved page data or an extracted article body directly through the production or preview host
- **THEN** the response reveals none of the requested records or body text
- **AND** the rendered page shows its source link, summary and namespaced IDs without embedding the private records or extracted body

### Requirement: Schedule daily discovery and release publication

The news-discovery GitHub Action SHALL be scheduled for 7:00 a.m. every day in `America/Chicago`. The Action SHALL write discovery evidence and release outputs without invoking the permanent Intake import or issuing database mutations.

#### Scenario: The scheduled run finds a preferred copy of an existing article

- **WHEN** the daily search finds a preferred URL for an article already present in the database
- **THEN** it updates the saved evidence, release JSON and affected HTML using the existing source identity
- **AND** the database row is updated only when the separate Intake import applies the change

### Requirement: Persist the identity assigned by the daily Action

Daily SHALL use each occurrence’s normalized publisher URL as its source ID in the `google.news` namespace. Daily SHALL write confirmed duplicate-to-target source IDs under `CoverageLink` in the release’s private `data/alias.json`. Intake SHALL read this file, follow alias chains and persist every source key against the same canonical article ID.

#### Scenario: Two record kinds use the same source ID

- **WHEN** `alias.json` contains the same key under `CoverageLink` and another record kind
- **THEN** Daily preserves both mappings and Intake uses only the `CoverageLink` target to resolve the article

#### Scenario: Preferred copy changes before import

- **WHEN** Daily accepts URL A, then groups a qualifying duplicate B with it
- **THEN** the saved data carries both normalized URL source keys, and the rendered article carries the source pair for the occurrence shown
- **AND** article-to-assignment relationship IDs persist across updates

#### Scenario: Import and rediscover through different keys

- **WHEN** either source key already maps to an article
- **THEN** Intake maps both keys to that canonical ID and resolves subsequent A-only and B-only imports to the same record
- **AND** if neither key exists Intake assigns one canonical article ID
- **AND** two previously distinct canonical IDs are reported as a conflict, and the same source ID in another namespace alone establishes no match

### Requirement: Limit news discovery to the past seven days

The daily Action and the local browser search SHALL request past-week results. To qualify, a new or cached story SHALL have a source publication date within the search date and six preceding calendar dates in `America/Chicago`. For multiple copies, discovery SHALL check the preferred source’s publication date.

#### Scenario: An old cached result precedes a current article

- **WHEN** a November 14 search returns a cached November 7 story updated today, then a qualifying story published November 8
- **THEN** discovery skips the November 7 story and accepts the November 8 story

#### Scenario: An older story is republished this week

- **WHEN** a copy published yesterday matches a story whose preferred source published last month
- **THEN** discovery continues searching for a current story

### Requirement: Select a dated article and preserve the evidence for each officer

Articles SHALL count as copies at 30% or greater overlap of distinct normalized main-body paragraphs, measured against the smaller set. An officer’s page SHALL link to a copy that supports that association. An undated occurrence SHALL remain evidence only until a source publication date is available.

#### Scenario: Three of ten paragraphs match

- **WHEN** exactly three of the smaller article’s ten distinct paragraphs match
- **THEN** the occurrence enters preferred-copy processing
- **AND** if it matches two established article IDs, preserve both and flag the ambiguity

#### Scenario: Evidence exists only in a nonpreferred copy

- **WHEN** the preferred copy omits the passage supporting an officer’s association
- **THEN** the officer’s page links to the supporting occurrence
- **AND** if a corrected extraction removes the last support for the published association, flag it for manual correction

#### Scenario: The first relevant result has no source date

- **WHEN** a result supports the officer association but lacks a source publication date
- **THEN** retain its evidence and continue the search for a dated qualifying result

### Requirement: Build agency coverage from personnel assignments

Coverage links SHALL attach to `AgencyPersonnel` assignments. Each agency page SHALL list the distinct articles linked through its own personnel assignments.

#### Scenario: One article is linked through multiple assignments

- **WHEN** a story links to two personnel assignments at agency A and no assignment at agency B
- **THEN** the story appears once on A’s agency page and is absent from B’s agency page

#### Scenario: A syndicated copy supplies an assignment’s link

- **WHEN** a syndicated copy supplies the link for the only assignment connecting an article to an agency
- **THEN** the agency entry uses that assignment’s source link

### Requirement: Discover news from individual personnel profiles

The daily Intake Action SHALL read all available query and landing-page rows for the latest seven finalized reporting days before ranking pairs. It SHALL keep exact paths to individual profiles in the release snapshot, search in descending impression order using the term and profile officer, and link the first qualifying article to that profile. The article SHALL name and concern that officer at an associated agency.

#### Scenario: A later results page contains the highest-impression profile pair

- **WHEN** the first results page includes a profile pair with 100 impressions and a later page contains an eligible pair with 900 impressions and fewer clicks
- **THEN** the Action finishes reading the available pages before issuing its first article search
- **AND** it searches the 900-impression pair ahead of the 100-impression pair

#### Scenario: Discovery and homepage ranking use different metrics

- **WHEN** one profile’s pair has 900 impressions and 5 clicks and a different profile’s pair has 100 impressions and 40 clicks over the same seven days
- **THEN** the daily Action searches the 900-impression pair first
- **AND** if each pair matches a different article and those are their only matches, the entry for the profile with 40 clicks ranks above the entry for the profile with 5 clicks on the homepage

#### Scenario: The same query appears for a profile and other pages

- **WHEN** a query has rows for an individual personnel profile, the personnel directory (`/personnel/`), a state page (`/tx/`) and an agency page
- **THEN** only the profile row enters the daily search queue, regardless of the impressions on the other rows
- **AND** only the profile row’s clicks contribute to homepage ranking when that pair matches an article

#### Scenario: A search term leads to two different profiles

- **WHEN** Search Console reports the same term for two individual personnel profiles
- **THEN** each search uses its own landing page and the original term
- **AND** a result concerning only the other page's entity does not qualify for the current page

#### Scenario: An already recorded article is the first qualifying result

- **WHEN** the saved article body supports the association for the landing page and the story’s publication date falls within the search window
- **THEN** the Action links the article to that page, updates its URL and paragraph match data as needed, and ends that targeted search

### Requirement: Compare query and profile position after coverage is added

For each matched query and individual profile, Intake SHALL use the time coverage became visible on the profile to compare Search Console average position across seven complete reporting days before and seven complete reporting days after publication, excluding the publication day. A comparison requires a reported position for the pair in both periods.

#### Scenario: The same profile appears for two queries

- **WHEN** coverage is added to a profile and Search Console reports average position for both queries before and after publication
- **THEN** each query’s before and after values are paired with that same profile and their reporting dates
- **AND** discovery remains ordered by impressions and homepage articles by combined seven-day clicks

### Requirement: Rank homepage news by recent organic search clicks

Clicks SHALL be measured per personnel landing page and search term. Homepage ordering SHALL sum each profile’s distinct matched pairs once over seven days and display its newest qualifying story. The homepage SHALL compare stories by the preferred source’s publication date and display the selected story with that source’s date, title and link. Profiles selecting the same story SHALL share one entry ordered by their combined profile totals. The homepage SHALL display up to 25 distinct stories.

#### Scenario: Two searches lead to the same page and match one article

- **WHEN** two distinct queries lead to the same individual personnel profile with 28 and 22 organic clicks in the seven-day window and both match the same article ID
- **THEN** the profile total is 50 clicks and its selected story appears at most once in the top 25
- **AND** reprocessing either pair for the same window does not add those clicks again

#### Scenario: A profile has two distinct dated stories

- **WHEN** one query for a profile has 28 clicks and matches an older qualifying article, and a second query for the same profile has 22 clicks and matches a newer, distinct qualifying article in the same seven-day window
- **THEN** the profile total is 50 clicks and the homepage entry displays the newer story
- **AND** a change to the preferred article URL preserves both landing-page/search-term counts

#### Scenario: A later syndicated copy names the officer

- **WHEN** a profile has one story whose preferred source published Monday, a Friday copy that supplies the officer evidence, and a distinct qualifying story whose preferred source published Wednesday
- **THEN** the homepage selects the Wednesday story and displays its preferred source’s date, title and link
- **AND** the officer’s page links to the Friday copy for the Monday story

#### Scenario: More than 25 articles qualify

- **WHEN** 30 profiles with different seven-day click totals each select a distinct article
- **THEN** the homepage lists the 25 highest-ranked articles in descending click order

### Requirement: Attribute submissions to the originating form

The website SHALL embed its release identity in each built form and submit it as `releaseId` through the configured environment-specific submission path. The service SHALL preserve that identity.

#### Scenario: An old form submits after deployment

- **WHEN** a form opened under release A submits after release B becomes active
- **THEN** the stored submission identifies A

#### Scenario: Preview and production use the same commit

- **WHEN** a preview form with a custom payload submits
- **THEN** its preview destination receives the originating preview release identity
