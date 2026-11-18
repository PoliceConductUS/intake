## Depends on

- [ ] `cache-call-results-and-files`, through its personnel photo task and its CourtListener and photo move, which alone moves `assets/PersonnelPhoto/` into the cache and sets `photo_id`.
- [x] A check of policeconduct.org for the names `assets` and `media`: `git grep` in its `main` finds none; its only use of `INTAKE_WORKSPACE` is for `command/.../previous-mutations/`.

## Implementation

- [ ] Move `RecordsRequest` to `state/intake/namespaces/<namespace>/` in `src/cli/requests/`; tests.
- [ ] Save downloaded reply messages and attachments in the sync's command folder, cached so they are not downloaded again (after `cache-call-results-and-files` phases 1 and 2); tests.
- [ ] Make the `gov/irvingtx/arrests` acquire read its files from its own command folder, where `intake data acquire gov/irvingtx/arrests --from-local <folder>` copies them, and not from `gov/irvingtx/arrests/source/`; tests with two acquires processed in order.
- [ ] Make every phase that reads acquired input find it through `retainedAcquiredInputs`, in its order, and through nothing else; check every source; tests.
- [ ] Extend `state/<namespace>/acquire.yaml`, through `readCommandPointer` and `writeCommandPointer` in `src/cli/state/command-pointer.ts`, to hold `resume` and the list of successful acquires in the order they ran, appended by `data acquire` when an acquire completes. Remove `latest`: make its readers (`src/cli/acquire/index.ts`, `src/cli/acquire/acquire-from-local.ts`, `src/cli/transform/index.ts`, `src/cli/data/source-pipeline.ts`, `src/cli/state/transform-completion.ts`, `src/cli/data/acquired-inputs.ts`, `src/cli/data/reset.ts`) use the list's last entry or the acquires chosen from the list. The one-time move writes the list for each namespace from its completed acquire commands, in `retainedAcquiredInputs` order, and drops `latest`; tests.
- [ ] Make `data generate` record in each `DatabaseMutations` envelope (`src/cli/import/artifacts/io/DatabaseMutations.ts`, `src/cli/data/chain.ts`) every acquire it included, an acquire that contributed no change among them: namespace, command ID, output path relative to the intake workspace, and the folder's `directoryDigest`. A generate that writes no mutation records nothing; strict schema and tests for both cases.
- [ ] Read which acquires are processed from the targeted database: the entries in its `data_mutation_applied` ledger whose files match the ledger's checksum, and the acquires they name; tests, including a database with no such entry, where every completed acquire is considered. Make `data transform` and `data generate`, run alone, replay every completed acquire not yet processed, in order, oldest first, before the latest, each through `data transform`, `data generate` and `data up`, as `data reset` does; tests with two acquires completed between transforms.
- [ ] Move `ResolvedProperty` to `state/intake/ResolvedProperty/` in `src/cli/state/resolved-property/index.ts`; tests.
- [ ] Move `InitialAgencyRoots` to `state/<namespace>/InitialAgencyRoots/` in `src/shared/io/initial-agency-roots.ts`; tests.
- [ ] Fail when `intake/state/` exists, in the one place state paths are built; tests.
- [ ] Fail on a state path with two `namespaces` folders; tests.
- [ ] Correct AGENTS.md, ADR 0010 and the README files under `src/`.

## One-time move

- [ ] Write the one-time script in a new folder beside `~/dev/PoliceConductUS/intake-workspace/migration-2026-11-17/`, with a `README.md` that records what was run and checked, as that folder's does; no migration code or command is added to intake. It moves each file under `intake/state/` to its new place, the files of `state/intake/namespaces/intake/ResolvedProperty/` to `state/intake/ResolvedProperty/`, `gov/` to `state/gov/`, and each file in `media/` into the cache as a `BinaryFile` under `org/policeconduct/manual` with its SHA-256 unchanged, listing each file no record uses; it removes the `captions` key, `null` in all 65 videos, from each video in `state/com/youtube/policeactivity/video-cache.json`; it removes `assets/` once the photo is in the cache with the same SHA-256, and `media/`. It leaves in place anything it has no rule for, and fails before moving anything on a destination that exists with different content.
- [ ] Run it on the clone that the `cache-call-results-and-files` move ran on, before the full CourtListener acquire; run it a second time on the same clone (it changes nothing) and once on a fresh clone after that change's move (the same output).

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. No Supabase migration changes, so no Supabase validation applies.
- [ ] After the move, assert the number of files under `state/` is the number before plus the files moved into it.
