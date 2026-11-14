# Approach

Remove the Oregon certificate predicate. Empty certificate tables produce no license records while roster people and supplied employment remain. Existing parsing, required-data validation, explicit exclusions and canonical identity mappings remain effective. No per-person correction or inclusion command is the roster fix; no source ID or corrected person name is hard-coded.

The user clarified that restoration must follow from intake code through the normal pipeline. The proposed data-include command is dropped. A mistaken local correction was removed through a tested temporary CLI operation, without changing source data or database rows. That operator-local cleanup is complete. The temporary operation, its tests, public documentation and specification delta are withdrawn from the delivered change; existing cache behavior remains unchanged.
