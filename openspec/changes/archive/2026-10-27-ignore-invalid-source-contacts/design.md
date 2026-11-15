## Design

Shared field classification identifies phone, email and URL fields by their canonical field names, independent of source and table. The generated entity schema supplies required/optional status. Pure validation returns a cleaned spec and defects; cached corrections run first. Invalid optional fields are omitted, and invalid required fields hold their records and dependent foreign-key records out of the plan. All omissions are logged with source identity, field, original value and reason. Raw artifacts and persistent exclusions are unchanged. Validation checks syntax, including all-zero phone placeholders, without DNS or network reachability tests.

Canonical source envelopes accept blank strings for these field types so cached corrections and defect handling run before rejection. Other nonblank constraints remain enforced by envelope IO.
