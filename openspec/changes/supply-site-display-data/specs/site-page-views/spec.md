## ADDED Requirements

### Requirement: Each page type reads one page view

Intake migrations SHALL define one materialized page view per page type, as listed in `design.md`, "Page-shaped views". Each SHALL hold one row per page, keyed by a unique `path`, with every column the page header and stats render. Each SHALL return the page's route segments and its stored `segment` or `slug`, so the site splits no path.

#### Scenario: Agency page lookup

- **WHEN** the build loads the agency page `/tx/dallas-county/irving/irving-police-department/`
- **THEN** one row of `site_agency_page` has that `path`, with its state, area and place segments, its `slug`, its names, its stored status and its counts from `site_agency_count`

#### Scenario: Help-collect value

- **WHEN** a place page needs the place's value for the help-collect link
- **THEN** it reads the stored `segment` column of its `site_location_page` row and does not split the path

### Requirement: Lists are read from views by a parent path

Every list on a page SHALL be read from a materialized view filtered by a parent-path column, such as `site_agency_page.place_path`, `site_location_page.parent_path`, `site_assignment.agency_path`, `site_report_personnel.report_path`, `site_civil_case_scope.scope_path`, `site_report_archive_report.archive_path` or `site_annotation.page_path`. A list row SHALL be defined once and reused by every page that lists it.

#### Scenario: Place lists its agencies

- **WHEN** the place page `/tx/dallas-county/irving/` lists its agencies
- **THEN** it reads `site_agency_page` rows whose `place_path` is that path, the same rows the agency pages read

#### Scenario: Agency civil case list follows the scope rule

- **WHEN** a person works at agency A and a civil case links the person's assignment at agency B
- **THEN** `site_civil_case_scope` has a row for that case under agency B's path and none under agency A's path

### Requirement: Rule views stay plain and page views are materialized

Rule and count views SHALL stay plain views and SHALL be the one definition of each rule. Page and list views SHALL be materialized views that read only rule views and tables. Each SHALL have a unique index on its own key and a btree index on each parent-path column. `public.refresh_site_projections()` SHALL refresh them in dependency order.

#### Scenario: One personnel page lookup

- **WHEN** the build reads one person's row from `site_personnel_page` by `path` after a refresh
- **THEN** the query uses the `path` index and does not evaluate the headline window over every assignment

### Requirement: Every location has its state from the parent chain

`site_location_state` SHALL return, for every `location_path` row, the state row reached through `parent_location_path_id`, with its `path` and stored `state_code`. Page views and `site_page` SHALL take a page's state path and state code from it. No view or site code SHALL take a state from a path segment.

#### Scenario: Sitemap grouping by state

- **WHEN** the sitemap groups last-modified dates by state
- **THEN** it groups `site_page` rows by `state_path`, which comes from `site_location_state`

### Requirement: The state maps come from states with agency pages

`site_state_map` SHALL return one row for each state that contains at least one `site_agency_page` agency, with the stored `state_code`, the state's `path` and `display_name`, `agency_count`, and `listed_personnel_count` from `site_personnel_state_count`. The build SHALL write these rows as JSON keyed by `state_code` to drive map highlighting, counts and links. The tile grid and map drawing SHALL be a static design asset keyed by the stored code, not content.

#### Scenario: State without agency pages

- **WHEN** a state row has no `site_agency_page` agency under it
- **THEN** `site_state_map` has no row for it, and the map shows it without highlight or link

#### Scenario: State with agency pages

- **WHEN** Texas has 1,200 agencies with pages
- **THEN** its `site_state_map` row has `state_code` `TX`, the path `/tx/` and `agency_count` 1200

### Requirement: site_page lists every page once

`site_page` SHALL be a materialized view with one row per page from every page view, holding `path`, page type, route segments, `state_path`, `state_code` and `lastmod`. A unique index on `path` SHALL make the refresh fail when two pages claim one path. `lastmod` SHALL be today's sitemap rule, moved: the latest `updated_at` or `created_at` of the page's record and of the records it lists.

#### Scenario: Two pages claim one path

- **WHEN** an agency page and a report page have the same `path`
- **THEN** the refresh fails and names the path

### Requirement: Each page names the record it is about

`site_page` SHALL hold, for every page, `entity_kind` (the intake record kind) and `entity_id` (its primary key) of the record the page is about; a topic or report archive page SHALL name its scope's record. Intake SHALL store no redirect pairs; the website build derives redirects from the previous release's sitemap and pages using these columns (owner, 2026-11-22).

#### Scenario: Agency topic page

- **WHEN** the agency `/tx/dallas-county/irving/irving-police-department/` has a `reports/` topic page
- **THEN** both `site_page` rows have `entity_kind` `Agency` and the agency's ID, with page types `agency` and `topic`

### Requirement: The personnel page row holds the whole page container

`site_personnel_page` SHALL hold everything the personnel page container renders: the path, the person's names, the deceased date and message, the headline assignment chosen by the headline rule inside the view (agency name and path, title, badge, employment status, end date, basis), the schema.org `worksFor` agency only when the basis is `Current`, the counts, the page title, the page description and `lastmod`.

#### Scenario: Most recent agency in the title

- **WHEN** every assignment of Pat One is `Former` and the latest ended at Agency B on 2015-01-01
- **THEN** the row's `page_title` is `Personnel Pat One | Most recent: Agency B | PoliceConduct.org`, its description says the assignment ended Jan 1, 2015, and `works_for_agency_name` is null
