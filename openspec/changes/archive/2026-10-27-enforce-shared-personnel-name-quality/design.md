## Restore the original boundary

Remove the Personnel field overrides added in c2cc615 and their schema module.
Remove the associated currentValueOnly exception from generated update readers.
Use the original database-derived Personnel specs at every canonical IO boundary.

Keep the existing generation correction adapter and Model resolvers unchanged.
Keep source values inspectable and explicit exclusions auditable; do not restore
old source-specific suffix clearing or name-based fixture inference.
