# Design

Add LicensingAuthority to HANDLED_RECORD_KINDS. Existing shared schema validates required name/location_path_id; existing canonical IO emits LicensingAuthorities. Supply stable source-local ID state-licensing-authority-<postal> and lowercase postal code for the existing state-location resolver. Do not supply or generate database IDs outside intake. Store source evidence in a workspace audit manifest mapped to source-local identities. Generate and inspect creates before applying a single scoped chain entry.
