# Shared graph selection design

## Placement

Selection runs after typed artifact loading and explicit corrections, before property resolution and mutation writing. Facades resolve canonical identities and graph-reference fields. Unrelated required properties such as agency geocoding are not resolved for unselected new records. A narrow database adapter reads graph columns for current candidates, their inclusion ancestors, and qualifying assignment/case witnesses. There is no full-table graph preload or source namespace branch.

## Root selection and retention

Compute roots in both the stored graph and the effective graph after field-wise incoming overlay. In each snapshot the root set is the union of agency IDs on assignments with end_date exactly null and agency IDs connected through CivilCasePersonnel -> AgencyPersonnel -> Agency. Traverse from the union of both snapshots' roots using effective graph edges. This includes the dataset that closes an agency's last assignment while subsequent imports see its ended status.

After traversal, retain incoming updates to existing canonical records. Retention does not expand the root set or traverse new descendants. Intake never deletes stored records. Required references to deliberately unselected new candidates fail visibly.

## Directed metadata

Agency -> assignments, agency phone numbers, agency links, federal branch links.
Assignments -> personnel, referenced licenses, case/review/discipline/coverage attribution links, arrest profiles.
Personnel -> licenses. Licenses -> license actions.
Attribution links -> their case/review/discipline/coverage records.
Cases -> case evidence links and case coverage links. Reviews -> review evidence links.

There is no reverse personnel-to-assignment or case-to-assignment-link traversal. Each case-connected agency qualifies directly as a root. State/location, licensing authority, authority license type, and federal organization reference kinds remain independent.

## Acquisition boundary

CourtListener continues to search and match against imported data. An agency may be filtered before that query; the user expressly accepts this. Root selection uses available incoming and stored case relationships. No candidate-aware lookup or cross-source staging is added.

## Validation

Literal graph fixtures cover both root sets, before/after selection, history, shared people/cases, strict null, overlays, reference isolation, and retained updates. Database tests cover scoped graph reads and before/after witnesses. Pipeline tests cover selection before geocoding, later-source updates, closing assignment persistence, and canonical identity preservation. Source tests cover complete TCOLE candidates and explicit MN null end dates.
