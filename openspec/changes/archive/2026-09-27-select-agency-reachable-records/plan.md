# Agency record selection implementation plan

**Goal:** Import agency-rooted reachable records using the agreed assignment/case root union and no-deletion invariant.
**Spec:** specs/agency-record-selection/spec.md and design.md.
**Architecture:** Pure shared graph selector, declared edges, narrow database reader, DataContext facade selection called by the import pipeline.
**Constraints:** Preserve canonical IDs and raw artifacts. No namespaces or source IDs in policy. No dependencies, schema changes, database deletes, or automatic resets.

## Task 1: Pure selection

Create src/cli/import/artifacts/agency-graph.ts and test/import/artifacts/agency-graph.test.ts. Graph records carry kind, canonical id, and graph properties. Define directed edge metadata and both assignment/case root sets, evaluated before and after incoming updates. Retain updates to existing records after traversal. First write literal fixtures asserting selected IDs: A with open/history selects both people; closed-only B remains out if it shares personnel or license authority; a shared case directly qualifies both agencies. Test undefined end_date and incoming replacement of stored assignment. Run the test before implementation, then implement indexed adjacency and queue traversal. Filter only managed kinds; reference records remain independent.

## Task 2: Pipeline integration

Create src/cli/database/agency-graph.ts to read graph columns from generated table metadata. Add DataContext.selectAgencyGraph(existingRecords), resolving only canonical IDs and graph fields. Integrate in config.ts before toDatabaseMutations. Write tests before edits using actual facades and database-backed imports; ensure rejected agency coordinates are never resolved and later-source case/report edges can reach stored qualifying assignments. Keep explicit exclusions upstream and report omitted counts.

## Task 3: Complete source candidates

Update sources/gov.tx.tcole/transform.ts and test/sources/gov.tx.tcole.test.ts to retain valid inactive departments and personnel regardless of department eligibility. Keep service identity construction unchanged. Verify existing MN current roster emission explicitly carries end_date null and strengthen test/sources/mn-post.test.ts. Run focused tests red then green.

## Task 4: Verification

Run focused source/graph/import tests, npm test -- --hookTimeout=180000, npm run typecheck, npm run build, scoped prettier --check, git diff --check, and npm run openspec:validate. Review correctness, dependency traversal and evidence preservation. Record exact results and data-application limits in verify.md.
