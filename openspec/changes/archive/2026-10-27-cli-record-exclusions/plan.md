# Exclusion visibility

Make existing explicit exclusions visible during transform without changing which
records are excluded. Print each matched source identity and its recorded reason,
then counts removed per kind, including dependent records. Do not report absent
source records as removed. Use the existing transform logger and exclusion cascade.

1. Add a failing transform regression for identity, reason, and removal counts.
2. Add logging around the existing exclusion operation.
3. Run focused exclusion/transform tests, typecheck, build, and OpenSpec validation.

No schema, cache policy, database writes, acquisition, or reset is needed.
