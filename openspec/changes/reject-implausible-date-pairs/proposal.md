# Reject implausible date pairs at intake

The existing date-pair check logs a defect but still permits database mutations. Intake must block mutation generation for an end before its start or a range over the existing 70-year review threshold. Preserve the input for inspection, report every defect with source identity, and permit a provenance-backed conditional correction before validation. Do not substitute a guessed year, clear the date, or infer employment status.

This changes import validation only. No database migration, reset, generated contract change, or public-site change. It prevents new invalid writes; it does not correct already-stored rows. Those remain unresolved until a supported correction or an explicit representation of unknown separation is available.
