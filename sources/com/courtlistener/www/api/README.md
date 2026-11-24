# api

## Overview

The intake source for namespace `com/courtlistener/www/api`: civil cases from CourtListener that name an officer of a known agency.

- `acquire` pages agencies from the data context, searches the CourtListener REST v4 RECAP search by party name for each agency through the shared CourtListener client, and writes one `<agency source ID>.dockets.json` for each agency. It fetches no docket entries, downloads no document and makes no model call.
- `transform` reads those files, resolves person-named parties to agency personnel through the data context, and emits `CivilCases`, `CivilCasePersonnel`, `CivilCaseLinks` and `LicensingAuthorities` artifacts. It supplies no complaint summary.
- A case's complaint summary is worked out in `data generate` by the civil case resolvers in `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`, from the docket address the case carries as `primary_source_url`.

Every docket row the transform reads ends in one of four outcomes:

| The docket                                                                                                             | Outcome                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Names an officer and has a title and a filing date                                                                     | A case is emitted.                                                                          |
| Names no officer of the agency                                                                                         | Left out, logged, and counted as not selected under `no matching officer`.                  |
| Names an officer but has no title or no valid filing date                                                              | No case; a `docket-not-buildable` warning on the licensing authority of the agency's state. |
| Has no ID, no address, or names an officer and has no court, no docket number or a termination date that is not a date | The transform throws, naming the file and the docket.                                       |

## Interface

- `intake.source.ts:source` - the `IntakeSource`: `description`, `produces` (`CivilCases`, `CivilCasePersonnel`, `CivilCaseLinks`, `LicensingAuthorities`), `acquire`, `transform`.
- `acquire.ts:acquire` - `SourceAcquire`; `({ sourceDir, env, data, logger, clients }) => Promise<void>`.
- `acquire.ts:STATE_COURTS` - state or territory code to the CourtListener court ids searched for it.
- `acquire.ts:Docket` (not exported) - type; one docket as `acquire` writes it: `id`, `case_name`, `docket_number`, `court`, `date_filed`, `date_terminated`, `cause`, `absolute_url`, `parties`.
- `transform.ts:transform` - `SourceTransform`; `({ paths, data, logger }) => Promise<{ artifacts, accounting }>`. Reads the `*.dockets.json` files named in `paths`, or found in the directories in `paths`.

## Invariants

- `acquire.ts:acquire` - throws `com/courtlistener/www/api: COURTLISTENER_MIN_YEAR is not a year: <value>.` before any request when the setting is blank or not a whole number. The search passes `filed_after=<year>-01-01`; the year is 2022 (`acquire.ts:DEFAULT_MIN_YEAR`, not exported) when the setting is absent.
- `acquire.ts:acquire` - throws `com/courtlistener/www/api: agency <agency ID> has no name.` for an agency with a blank name, and `com/courtlistener/www/api: agency <agency ID> is in state "<state>", which has no court list.` for a state with no `STATE_COURTS` entry. No later agency is searched.
- `acquire.ts:acquire` - each agency's file is `<encodeURIComponent(agency ID)>.dockets.json`, written as soon as that agency's searches are done. Two agencies with one name in different states each have their own file and their own searches.
- `acquire.ts:acquire` - an agency is searched under its name and one more party name: its county when the name contains "county", "sheriff" or "parish" and it has a county; else `City of <place>` when it has a place; else its county (`acquire.ts:partyNames`, not exported). `/` and `\` in a party name become spaces.
- `acquire.ts:acquire` - each search is made with `refreshAfterMs` of 120 days (`acquire.ts:REFRESH_DAYS`, not exported), so a search result is used from the cache until it is 120 days old.
- `acquire.ts:acquire` - a search that fails for one agency (`failed`), or that is `skipped` because CourtListener went down during the run, writes no file for that agency. The agency and the reason are logged, and the last log line counts the agencies written, left out after a failed search, and left out while CourtListener was down. The CourtListener client throws `ServiceUnavailableError` when the service is down, or `COURTLISTENER_API_TOKEN` is not set, before the first search.
- `acquire.ts:docketOfHit` (not exported) - throws `com/courtlistener/www/api: a search result for agency <agency ID> (party "<party name>") has no docket ID.` or `... has no list of parties.` A docket returned by both of an agency's searches is written once.
- `transform.ts:transform` - throws when `data` is undefined.
- `transform.ts:transform` - throws `com/courtlistener/www/api: cannot read input path <path>: <problem>` for a path that cannot be read as a directory, and `com/courtlistener/www/api: cannot read <file>: <problem>` for a file that cannot be read or is not JSON. The directories in `paths` are scanned (`transform.ts:collectEnvelopePaths`, not exported) only when no path in `paths` ends with `.dockets.json`.
- `transform.ts:transform` - throws `<file> has no agency ID, name or state.` and `<file> has no list of dockets.`
- `transform.ts:transform` - throws `<file> docket <position> has no ID.` and `<file> docket <ID> has no address.` for any docket, and `<file> docket <ID> names an officer but has no court or no docket number.` and `<file> docket <ID> has a termination date that is not a date: <value>.` for a docket that would build a case.
- `transform.ts:transform` - a docket with no party that resolves to agency personnel is left out; the log line is `com/courtlistener/www/api: docket <ID> (<URL>) left out: no matching officer.`
- `transform.ts:transform` - officer matching runs before the title and date check. A docket that names an officer but has no `case_name`, or no `date_filed` that starts with `YYYY-MM-DD`, writes no case and adds one `docket-not-buildable` warning, with the docket ID as its source record ID, to the findings of the agency's state. The message is `A court case naming an officer of <agency name> is not shown on this site because CourtListener, a free website of court records, lists it without <a title | a filing date | a title and a filing date>. You can see the case here: <docket URL>`. The same docket found for two agencies of one state is reported once.
- `transform.ts:transform` - emits one `LicensingAuthorities` record for each state it read a file for, through `sources/lib/state-authority-findings.ts:stateAuthorityRecords`: a partial update selected by the state's location path, with `metadata.defects` holding that state's findings, and an empty list when there are none. `data generate` fails for a state that has no licensing authority.
- `transform.ts:transform` - the case id is `civilCaseNaturalId(court, docketNumber)`. `claims_summary` is the docket's `cause`, else the case name. `location_path_id` is the lower-cased agency state. `primary_source_url` and the `CivilCaseLinks` record carry the docket's address on `https://www.courtlistener.com`.
- `transform.ts:transform` - when a later docket gives a case that is already written different content (the same docket found for agencies in two states, or two CourtListener dockets with one court and docket number), the later one replaces it and the log says `case <case ID> from docket <ID> in <file> replaces a different record of the same case from docket <ID> in <file>.`
- `transform.ts:transform` - `accounting` has one entry, `dockets`: every docket row of every file is read once and is emitted, reported, or not selected under `no matching officer`. The last log line of the transform counts the cases, case-personnel links and source links written and the dockets left out by reason.

## Side Effects

- `acquire.ts:acquire` - reads `COURTLISTENER_MIN_YEAR` from `env`. `COURTLISTENER_API_TOKEN` is read by the CourtListener client.
- `acquire.ts:acquire` - pages agencies with `data.agencies({ states: Object.keys(STATE_COURTS), minOfficers: 1, limit: 50 })`.
- `acquire.ts:acquire` - searches through `clients.courtListener.searchDockets`, which reads and writes the cache of call results; writes `<sourceDir>/<encodeURIComponent(agency ID)>.dockets.json` and no other file; logs one line for each agency and the counts.
- `transform.ts:transform` - reads the `*.dockets.json` files; calls `data.resolvePersonnel` for each person-named party; logs each docket left out and the counts. No writes.

## Verification

- Run: `npx vitest run test/sources/com/courtlistener/www/api test/import/artifacts/complaint-summary-resolvers.test.ts test/import/complaint-summary.integration.test.ts`
