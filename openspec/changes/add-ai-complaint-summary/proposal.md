## Why

A complaint summary needs its own source provenance and AI disclosure; legacy claims_summary mixes unrelated content.

## What Changes

Add optional civil_cases.ai_complaint_summary JSON containing the summary, complaint provenance, model, generation date, page support, limitations, and separately attributed procedural context. Reject incomplete non-null summaries at intake and website data access. Render escaped paragraphs, citation, filing date, retrieval date, confidence, and separate procedural context. No legacy relabeling.

## Impact

Intake schema migration and generated contracts; website detail loader and template. Existing rows remain null; no backfill. Local disposable database only. Private source data stays outside repositories. No merge, deployment or publication.

Board follow-up: show an honest unavailable-summary message with /donate/ navigation. Add nullable sourced unavailability metadata; null means unassessed, never missing. Preserve distinct missing-copy, pending, retrieval, authentication and generation failure reasons. No purchases or public deployment.
