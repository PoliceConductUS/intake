## Why

Invalid source dates must not prevent valid records from completing generation
and reset. Persistent record exclusions are inappropriate for defects that may
be corrected in a later acquisition.

## What Changes

Root intake applies existing conditional corrections, checks dates, and logs and
omits records with retained date defects for the current generation. Existing
shared dependency filtering also omits their dependents. Source values remain
inspectable and a later run evaluates them anew. No guessed dates, cleared end
dates, persistent exclusions, or source-specific rules are introduced.

## Impact

No database schema or migration change. Omission does not delete existing database
rows. The existing date checks and generation-time correction placement remain.
