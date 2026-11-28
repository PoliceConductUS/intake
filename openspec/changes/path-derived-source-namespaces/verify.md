# Local namespace migration verification

## Workspace and discovery

The existing Intake worktree discovered 21 source modules, including 10 automatic sources, from their nested entry points. The migration processed 5,980,371 state files. Raw acquisition outputs for 19 completed commands matched their recovery copies across 123,185 files. All 12 current acquisition pointers resolved. The original workspace passed a recursive read-only permission check. Local commands now select the writable dev workspace.

## Acquisition history

The local no-acquire database rebuild replayed all 14 retained automatic acquisitions in source and acquisition order. Oregon contributed four and Minnesota contributed two. Eight other automatic sources contributed one each. The preparatory validation also transformed each input. The manual location and final manual passes used the existing standalone source behavior. Four historical manual acquisitions and one standalone submissions acquisition retained their files separately. The inventory also identified 120 successful commands with pruned output, five failed commands and eight commands with insufficient completion evidence.

The second Minnesota import exhausted a 12 GiB JavaScript heap. The rebuild resumed after its verified first roster transaction and completed the remaining phases in fresh processes. A 24 GiB limit was available. The highest observed macOS memory footprint after monitoring began was 14.80 GiB during manual generation. The Minnesota retry completed before the monitor was installed.

## Minnesota records

September and October contributed 10,638 and 11,201 distinct personnel source IDs, respectively. The database contains every one of the 50 officers appearing only in September and the 613 appearing only in October. The union of personnel and license source IDs across 53 historical transform outputs matches the two retained roster inputs. Database checks verified all 11,251 people, 11,659 assignments, 11,462 license holdings and 532 discipline records from the two inputs. All 11,308 distinct agency/person/start-date combinations in the August transform also appear in the rebuilt source records. The 76 historical discipline identities that changed source keys match the saved alias receipts and existing canonical IDs.

Four successful Minnesota commands have pruned output directories. The two October 17 staging runs used an audited input folder whose 12,797 files match the final acquisition byte for byte. For the earlier October 18 staging folder, 13,257 files match and 531 document files differ. All differing files retain the same document URLs, checksums and extracted text. The differences include older analysis and review metadata. The August transform outputs are available for record comparisons. Exact historical input bytes cannot be established for every missing acquisition.

## Database results

Across the original 24 tables with text IDs, all pre-reset canonical IDs and slugs survived except 85 agencies and their 159 phone records. The pre-reset database dump confirms that each excluded agency had zero personnel assignments. All 216,469 assignments, 162,629 personnel and 1,803,731 education records survived. Five PSV articles initially failed to resolve after agency display names expanded. The agency lookup now uses the same approved abbreviations as the importer. Replaying the retained PSV input restored all five article IDs and their six assignment links. All 15 applied mutation files, predecessor links and 554 referenced chunks passed checksum verification.

## Local validation

Intake passed 1,987 tests in 194 suites and validated 53 OpenSpec items on Node 24.21.0. The website used its declared Node 26.13.1 runtime. Its validation covered formatting, lint, Astro checks, database schema, OpenSpec, the personal-data scan, 359 Node tests and 216 browser tests. No tests were skipped. The Intake toolchain printed an available Supabase CLI upgrade notice. Validation was local to the existing worktrees. No release was published.
