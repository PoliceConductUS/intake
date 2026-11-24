## MODIFIED Requirements

### Requirement: Preserve and enumerate public source evidence

The source SHALL acquire all pages for each configured name prefix (A-Z by default),
retain unchanged HTML, deduplicate officer/agency affiliations by source identity,
and fetch each officer's employment and certification pages and linked agencies.
It SHALL distinguish a targeted prefix run from statewide coverage. It SHALL NOT
claim a complete acquisition on transport, parse, session or pagination failure.
It SHALL get every page through the shared file download client: one call result
for each search prefix, one for each officer's employment and certificate pages,
and one for each agency page. A search prefix and an officer's pages SHALL each be
fetched from the first page to the last in one session, and SHALL be kept only
when every page passes the acquisition's checks. A request SHALL name the
prefix, the officer page URL with the officer ID, or the agency page URL, and
SHALL NOT hold the ASP.NET view state, the event validation value or a session
cookie.

#### Scenario: Search and detail pagination

- **WHEN** a public search or detail table has another page
- **THEN** acquisition follows its actual postback and retains every page.

#### Scenario: Public session expires

- **WHEN** the site redirects a request to its own public Logout page
- **THEN** acquisition opens and validates the public search form, and fetches that search prefix or officer again from its first page, or asks for that agency page again, once
- **AND** logs the renewal, and treats another redirect or any unrelated redirect as the site being unavailable, so the request is retried and then skipped and acquisition fails at its end.

#### Scenario: Missing agency

- **WHEN** the source explicitly responds No Data Found
- **THEN** preserve the response and report the agency as unavailable without
  inventing an address or emitting dangling assignment references.

#### Scenario: Agency lookup returns multiple rows

- **WHEN** an agency lookup returns multiple rows
- **THEN** select the unique row whose exact name matches the roster affiliation
- **AND** fail if the matching identity is missing or ambiguous.

#### Scenario: Resume interrupted statewide acquisition

- **WHEN** acquisition is run again after an acquisition that stopped partway
- **THEN** each search prefix, officer page set and agency page whose call result stands is taken from the cache without a request
- **AND** each one with no standing call result is fetched from its first page in the current session
- **AND** the interrupted acquisition's raw evidence is unchanged.

#### Scenario: A unit's pages fail a check

- **WHEN** a fetched search prefix or officer page set has a page out of sequence (a pagination gap), a repeated page, or a page its parser rejects
- **THEN** it is not kept as an answer, and acquisition fails without claiming a complete acquisition.

#### Scenario: A different prefix scope

- **WHEN** acquisition runs with a prefix list that shares prefixes with an earlier acquisition
- **THEN** the shared prefixes whose call results stand are taken from the cache, and only the other prefixes are fetched.

#### Scenario: The same request in a new session

- **WHEN** a search prefix is fetched in a session whose view state and cookie differ from an earlier session's
- **THEN** its request has the same fingerprint as the earlier one.
