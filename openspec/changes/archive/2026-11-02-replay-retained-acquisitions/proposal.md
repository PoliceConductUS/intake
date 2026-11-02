# Replay retained acquisitions during reset

## Why

Reset currently transforms only each source's latest acquisition, losing records present only in earlier retained snapshots. The board requested shared ordered replay as part of INS-112, with no Minnesota-specific branch.

Reset will transform, generate and apply each retained acquisition through the latest completed acquisition in acquisition order, within existing source dependency order. Standalone sources retain their standalone execution. Existing canonical identities, corrections, and unrelated cache values survive reset. Superseded acquisition outputs can be removed explicitly by the operator; command audit descriptors remain.

No schema changes, new acquisition during isolated verification, merge or deployment. The case migration will use existing audited corrections with only its resolved slug cache entries retired in an isolated copy before reset. Redirects use the board-directed workspace old-path to new-path map.

## What Changes

Rebuild retained source history in chronological acquisition order while preserving identities and bounding replay payloads.
