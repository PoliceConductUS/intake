## Why

A complaint summary needs its own source provenance and AI disclosure; legacy claims_summary mixes unrelated content.

## What Changes

Add optional civil_cases.ai_complaint_summary JSON. Require only summary text and an HTTP(S) complaint link. Retain other supplied metadata without requiring hashes, verified-byte flags, model details, dates, paragraph support, limitations, or procedural context. Render escaped summary paragraphs with an AI label and complaint link. Keep legacy claims_summary separate.

## Impact

Intake schema migration and generated contracts; website detail loader and template. Existing rows remain null; no backfill. Local disposable database only. Private source data stays outside repositories. No merge, deployment or publication.

Board follow-up: show an honest unavailable-summary message with /donate/ navigation. Add nullable sourced unavailability metadata; null means unassessed, never missing. Preserve distinct missing-copy, pending, retrieval, authentication and generation failure reasons. No purchases or public deployment.
