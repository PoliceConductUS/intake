## Decision

Remove Review's read-only upsert override. The generic facade compares source fields to the stored row and emits an update with set/check operations. The mutation planner already removes check-only updates. Source identity and slug resolution continue using the existing canonical rules.

## Validation

A disposable PostgreSQL test drives the real CLI command handler: create a manual report, apply it, edit its prose through acquire, transform, generate, inspect the generated ReviewUpdate, apply it, and verify the saved prose and unchanged ID/slug. Repeat generation to prove an unchanged report creates no entry. The user's live report and immutable history are not test fixtures.

## Incident timestamp regression

A subsequent real title-only edit failed with `ReviewUpdate is malformed at spec.operations.2.from.` The first regression omitted incident_date. Extend the CLI regression with a PostgreSQL timestamp before selecting the repair; timestamp values must validate and round-trip without repeated updates or arbitrary prose coercion.

Use schema-derived timestamp field metadata for comparison in generation and optimistic replay checks. PostgreSQL timestamp values must remain valid string envelope values. Equivalent representations of the same whole-second instant compare equal; changed instants remain updates. This normalization applies only to declared source-writable timestamp fields, not report prose, managed audit timestamps, or other strings.

The user selected an explicit-timezone requirement for timestamp input. Enforce it in the shared canonical specs for timestamptz columns, including source records and mutation operations, and reject timezone-less values before host-dependent normalization. Date-only fields are unchanged. No default timezone is assigned.

The user specified whole-second resolution and then explicitly chose truncation instead of rejecting fractions. Accept timezone-qualified fractional input and discard fractional digits before timestamp parsing so database microsecond rounding cannot carry into the next second. Apply the same whole-second normalization when building mutation values, writing create/update values, and comparing optimistic checks. Preserve raw source values; do not transform the canonical input schema into a lossy parser. Date-only and managed audit fields remain unchanged. No migration, default timezone, or live data rewrite is needed.

Reject impossible calendar dates before normalization. JavaScript Date otherwise rolls invalid month days forward, silently changing incident dates that PostgreSQL previously rejected. Validate the calendar-date prefix without transforming the source timestamp.
