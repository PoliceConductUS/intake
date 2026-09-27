# Why

A fresh reset lacks stored agency history, so the ordinary root filter omits published historical TX agencies that incremental intake retained. Production sitemap agency pages supply the user-selected initial root set.

# What Changes

Persist a source-namespaced initial Agency root list through canonical IO. On an import into an empty agency table, resolve listed source names to candidate canonical IDs and add them to the shared traversal roots. Nonempty imports keep existing selection behavior. Capture exact production sitemap/backup/ledger matches as provenance.

# Capabilities

## Modified Capabilities

- `agency-record-selection`: optional initial roots for an empty agency table, configured for TCOLE.

# Impact

Shared canonical IO for initial roots, graph selection and import wiring, focused regression tests, and a durable TCOLE initial-root input in the workspace. No schema migration, seed, dependency, or viewer changes. Validate a complete fresh reset and compare to preserved baselines.
