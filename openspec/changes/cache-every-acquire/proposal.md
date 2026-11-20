## Why

Two mechanisms carry an acquire's work to the next run: `resume` in `acquire.yaml`, which copies an interrupted acquire's output folder into the next one, and `previousSourceDirs`, earlier output folders handed to the Census acquire (see the [design](design.md)). The owner ruled on 2026-11-18 that both are removed once every call result and downloaded file an acquire makes goes through the cache, so that an interrupted acquire is simply run again: `resume` copies a whole earlier folder forward, stale files included, where the cache returns only the answers a new acquire asks for. Four acquires still call outside the cache and reuse their output folder: Census Gazetteer, Oregon DPSST, Minnesota POST and Wikipedia federal agencies. The owner named this change as the follow-up that moves them onto the cache and then removes both. The design's Terms, and those of `cache-call-results-and-files` it imports, define the words used below (attempt, host check, item failure, outage, session state, skipped, fingerprint, call result).

## What Changes

- **The file download client takes the request and the attempt from its caller.** When the URL alone does not identify a request (a form post, a range request, a batch of Apex actions), the caller names the `operation` and the `parameters` that decide the answer, and may supply the attempt that makes the call and sorts its answer into a file, a JSON response, an item failure or an outage. An attempt that throws fails the command. Session state is never part of the request: no view state, event validation value, cookie, Aura context or token, action ID or request counter. The same request made in a new session gets the same fingerprint. The host check before the first call to a host uses the client's own fetch.
- **Census Gazetteer.** The Gazetteer pages, TIGER listings and source files are cached downloads. On each acquire a range request fetches the tail of each ZIP. The download request for the whole ZIP names the SHA-256 of that tail and the size. So a changed remote file is a new request, and an unchanged one is taken from the cache. The acquire no longer looks in earlier folders.
- **Oregon DPSST.** The acquire makes one call per search prefix, one per officer (employment and certificate pages together) and one per agency page. A prefix or an officer is fetched from its first page to its last in one session; a session renewal starts it again. Its pages are kept together as one answer, so the view state never crosses a cache entry. The acquire no longer reads a `manifest.json` already in its output, and no longer writes `session-form.html`.
- **Minnesota POST.** The statistics page, the agency CSV, and each agency search, agency roster, license search and officer's details are cached calls. The browser opens only when a call is not answered by the cache. The acquire no longer reads the agency CSV, rosters, details or discipline request files already in its output. Order documents are left to `cache-call-results-and-files`' Minnesota task, whose design is not written yet.
- **Wikipedia federal agencies.** The list page is a cached download.
- **Refresh intervals (owner's decision, 2026-11-18).** Every successful answer of the four acquires stands for 7 days (nothing is deleted after), except the Minnesota order documents, whose interval `cache-call-results-and-files` sets. Census tail requests are made again on every acquire. A Census ZIP is kept until its tail or size changes; a ZIP whose tail does not identify it is downloaded on every acquire, as today. The owner's other decisions of that day are in the design's "Owner decisions" section.
- **Every answer the output needs is kept in the cache and also written to the command folder,** in the file names the transforms read today. The transforms do not change.
- **`resume` is removed.** `data acquire` and `data acquire --from-local` no longer write it, and `data acquire` no longer copies an earlier output into a new one. `readCommandPointer` fails, naming the file, on an `acquire.yaml` that still holds `resume`.
- **`previousSourceDirs` is removed** from `AcquireDeps`. No acquire is handed an earlier folder.
- **A call one of these four acquires needs that fails or is skipped does not end the acquire at once.** The acquire makes its other calls that do not depend on that answer, so their answers are kept in the cache. It then fails, naming each failed or skipped call, and is not recorded as completed. Running it again calls only what the cache does not answer. A host check that gets no answer still stops the acquire at once.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `config-driven-source-import`: An earlier acquire reaches a later one only through the cache; no acquire is handed an earlier folder. The four acquires make every call through the cache, with the owner's refresh intervals, and do not complete with a missing answer. Census ZIPs are reused from the cache, not from earlier folders.
- `workspace-state-layout` (added by `keep-state-under-one-root`): `acquire.yaml` holds `acquires` and no `resume`.
- `oregon-dpsst`: Pages are cached by search prefix, officer and agency. A run after an interruption takes standing answers from the cache.
- `mn-post-discipline-coverage`: Every call the acquire makes to the license search site and to the statistics page is a cached call, and a bot challenge is never kept. An Apex action request names the action, not the session, and an officer's details are one call result.
- `intake-stage-completion`: A failed acquire whose calls go through the cache keeps its answers in the cache instead of leaving resumable files.
- `service-clients` (added by `cache-call-results-and-files`): The file download client takes the operation, the parameters and the attempt from its caller, and its host check uses its own fetch. An outage does not fail the command by itself; a caller that needs the skipped answer decides.
- `call-and-file-cache` (added by `cache-call-results-and-files`): The downloads of one URL are listed across the call results whose request names that URL, since one URL can now have several requests.

The accepted `mn-post-discipline-orders` scenario "a resumed acquire re-does nothing already on disk" has no delta here. `cache-call-results-and-files` removes the requirement that holds it and replaces it with a cache-based scenario.

The `workspace-state-layout`, `service-clients` and `call-and-file-cache` deltas modify requirements that `keep-state-under-one-root` and `cache-call-results-and-files` add. Those changes are archived before this one.

## Impact

Affected intake sources: `gov/census/www2/gazetteer`, `net/bpl-orsnapshot/www/public-inquiry-cj`, `com/site/my/mnitservices/post-license-search`, `org/wikipedia/en/us-federal-law-enforcement-agencies`, and their tests and README files. Affected shared code: `src/shared/services/download-client.ts`, `src/shared/services/client-base.ts`, `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`, `src/cli/transform/parse/zip.ts`, `src/cli/state/command-pointer.ts`, `src/cli/acquire/index.ts`, `src/cli/acquire/acquire-from-local.ts`, a new `src/cli/acquire/acquire-failure.ts`, `src/cli/transform/source-transform.ts`, and their tests and README files; `test/shared/services/harness.ts`, `test/architecture.test.ts`, the `resume` fixtures of `test/cli/data/reset.test.ts`, and `sources/net/bpl-orsnapshot/www/README.md`.

Supabase: no migration, no data reset, no generated type refresh. Downstream app contracts: none. The acquire output files and the transforms are unchanged, except that Oregon no longer writes `session-form.html` and Minnesota no longer writes `discipline-requests/<license>.complete.json`; no transform reads either.

Workspace: none of the four sources has `resume` in its `acquire.yaml` in any workspace under `~/dev/PoliceConductUS/intake-workspace/` (checked 2026-11-18). The only `resume` is CourtListener's in `dev`, and the `cache-call-results-and-files` move deletes it. So this change needs no workspace move; a check just before its code first runs asserts that no `resume` is left. The first acquire of each source after this change finds nothing in the cache and downloads everything once. For Census that is 516 MB, the size of the dev workspace's last Census output.

Order: after `cache-call-results-and-files`' Implementation Plan steps 1 to 6, its two open tasks that write call results and files through a temporary name, the owner's answer to its open question 12 (stable cache keys), and `keep-state-under-one-root`'s code; and the owner's answers to this design's open questions, among them 1 (a standing item failure), 4 (where fail at the end lives), 5 (large answers, which Oregon needs) and 7 (whether Minnesota stays in this change). The client options land before `cache-call-results-and-files`' Minnesota task; the Minnesota part comes after it. The four sources and the removal of `resume` and `previousSourceDirs` land together. By the owner's ruling, `cache-call-results-and-files` and `keep-state-under-one-root` keep `resume`, and this change removes it.
