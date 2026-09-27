# Agency-rooted record selection

## Agreed outcome

Included root agencies are the unique union of agencies with assignments whose end_date is exactly null and agencies linked to a civil case. For each import, use roots from both the stored graph and the graph with incoming updates applied. The dataset ending the last open assignment therefore still includes its agency. Include all current and historical assignments at root agencies, their personnel, and directed descendants. Shared personnel and reference records do not qualify another agency.

Intake never deletes records. Existing records remain eligible for factual updates even after their agency no longer qualifies. Keeping a stored record does not itself select new descendants. Licensing authorities accompany state reference data independently.

## Approach and scope

Source adapters interpret exports and preserve candidate records. Shared selection runs before mutation generation using canonical identities. Cases qualify agencies through CivilCasePersonnel -> AgencyPersonnel -> Agency in the current schema. Existing mappings and URLs remain authoritative.

The user accepts that an agency may be filtered before CourtListener is queried. Acquisition and case matching remain unchanged; selection uses the case relationships available to the import. No candidate staging or new CaseAgency entity is introduced. Raw inputs and candidate artifacts remain inspectable. No live acquisition, database reset, or historical restoration is performed by this implementation.
