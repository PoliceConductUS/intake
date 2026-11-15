# Why

Visitors need geographic context for arrest beat codes.

# What Changes

Show official patrol boundaries labeled with beat names and arrest counts on personnel and agency pages only. Use agency booking aggregates, never sums of personnel profiles. Preserve unmapped arrests in totals. Geographic rollups are deferred at user direction.

# Impact

Intake acquisition/transform JSON contract and website data loaders/map component. Agency profiles require reacquisition and transformation to include boundaries. No new tables, migrations, durable IDs, dependencies, reset, or deployment. Private arrest points and booking identifiers remain private.
