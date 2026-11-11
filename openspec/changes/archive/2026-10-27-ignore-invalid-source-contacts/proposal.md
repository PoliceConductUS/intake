## Why

Placeholder phone, email and URL values must not become published phone numbers, email addresses, or websites. Persistent record exclusions also suppress later corrected source values.

## What Changes

During generation, apply cached corrections before checking phone, email and URL values. Omit clearly invalid phone, email and URL values and log source data defects with source, kind, record key, field, value and reason. A phone-only record without a valid number is omitted without excluding its agency or unrelated records. Raw artifacts remain unchanged. Source envelope string fields preserve blanks until correction and defect handling. Database constraints remain unchanged.

## Impact

Shared import preparation, contact validation tests, and two workspace phone cache corrections. Validation is attached to shared field types, including required evidence/link URLs, across every source and record kind. Invalid required values hold the affected record and dependent links out of the mutation plan.
