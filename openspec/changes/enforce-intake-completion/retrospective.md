# Retrospective: enforce-intake-completion

Written 2026-10-18. Implementation range: `c7893cb..fb64628`.

## Evidence

- Four implementation commits cover shared handoff enforcement, review corrections, current document hosting and explicit absence reasons.
- Final suite: 141 files / 1,373 tests pass. Independent focused review: 106 tests pass. Lint/build/OpenSpec pass; aggregate validation retains the unrelated pre-existing formatting failure.
- Actual full acquisition reviewed 531 URLs / 530 unique PDFs. Entry `000020` applied 532 reviewed updates. Database checks preserve 531 personnel identities and Minneapolis's 679-person roster / 13 people with discipline.
- No dependencies, database schema changes or website code changes were introduced.
- Review reports, before/after analyses, original sources and rejected first-pass delta remain in the persistent `mn-post-document-recovery-20261018` audit.

## What worked

Failing tests exercised real handoff paths, including the internal import helper and local acquisition. Independent review found bypasses and required corrections before release. A complete source audit caught missing factual bases before the first-pass delta was applied.

## What failed

The first document review interpreted allegation too narrowly. It omitted named and unnamed convictions, diversion and licensing failures despite the source stating them. Matching generated fields to saved analyses proved faithful copying, not complete extraction. The revised contract requires every absent field to have an explicit reviewed explanation, and the prompt includes the actual factual-basis cases. These checks make omissions reviewable; they do not guarantee semantic correctness.

## Plan deviations

The user explicitly requires merge and worktree cleanup before the production build. Release verification and final archival therefore follow integration; they are not marked complete in advance. Existing compatible chain tooling is used without modifications because unrelated historical mutation kinds are not represented on intake main. The 34 unresolved licenses remain unresolved as directed.

## Workflow

OpenSpec, debugging, worktree isolation, test-first implementation, independent review and verification were used. The finishing workflow follows the user's already authorized integration/release order. Publication remains pending until recorded in verification.
