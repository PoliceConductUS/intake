# Why

MN POST emits compact nine-digit ZIP+4 values that do not match the canonical hyphenated format, blocking transformation.

# What Changes

Format exactly nine source digits as five digits, hyphen, four digits in MN POST. Preserve agencies and assignments.

# Capabilities

## New Capabilities

- `mn-post-agency-validation`: normalize compact ZIP+4 before canonical validation.

# Impact

MN source transform and regression tests only. No database schema, seed, generated contract, dependency, or viewer changes.
