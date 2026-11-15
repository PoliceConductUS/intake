# Design

Store status and status_date directly on public.agency. Both are nullable, with no inferred default status/date. Apply the existing nonblank-text convention to a supplied status. Generated specs expose nullable optional fields, retaining the existing distinction between omitted updates and explicit null.

TCOLE maps STATUS to status without inventing a new status vocabulary. DATE_OFFICIAL is converted using the existing date-cell conversion to YYYY-MM-DD; a missing date becomes null. The interpretation that this is the current status's official date is the user's explicit assumption, not verified TCOLE documentation.

Use existing intake mutation generation/application. Agency root selection continues to depend on assignments and cases. This change introduces no additional audit or event behavior. The viewer is out of scope.

MN POST inspection found no agency operating status or status date in its agency CSV, rosters, or officer details across three acquired snapshots. activeEmployment.agencyStatus is Primary/Secondary employment designation, with different values for officers at the same agency; roster status is license status. Neither maps to Agency.status. MN therefore omits both fields, retaining the existing absent-field behavior.
