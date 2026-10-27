# Oregon DPSST source

The user approved implementation after a live bulk POC: agencies, officers,
employment and certifications first; training and education remain outside scope.
The user approved one Oregon worktree. Public CJ IRIS pages expose real employment
events, certification statuses and dates, and agency contact information. The POC
proved paginated searches, session-bound details and agency records. An explicit
No Data Found agency response is a real data gap, not a transport success implying
usable data. No schema changes or invented employment dates are approved.

Use the existing acquire -> transform -> generate -> up pipeline. Keep downloaded
HTML as evidence. Build deterministic source-local identities and let shared IO,
identity mapping, validation, selection and property resolution govern imports.
