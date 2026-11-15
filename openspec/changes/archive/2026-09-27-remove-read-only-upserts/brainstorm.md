# Remove silent read-only imports

The user authorized fixing the three remaining read-only upserts and explicitly prohibiting this shortcut in documentation. LocationPath, LocationPathAlias, and ReviewPersonnel currently discard edits whenever the row exists. Stable identity does not imply immutable content. Existing field-level identity and URL constraints remain authoritative.

Use the existing generic create/update comparison. Remove the unused read-only upsert mode so configuration cannot reintroduce the bypass. Explicit read/assertion envelopes remain supported. No database reset, live source rewrite, or bulk regeneration is required.
