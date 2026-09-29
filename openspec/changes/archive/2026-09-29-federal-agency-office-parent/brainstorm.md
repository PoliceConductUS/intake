# Federal agency office parent

The user selected a direct nullable `agency.parent_federal_agency_id` foreign key
to `federal_agency.id`, replacing the removed branch join table. Offices remain
ordinary agencies with existing canonical IDs and place URLs. The federal parent
page can list its agencies through this relationship. Website implementation is
assigned separately.

The September 27 source contained 11 offices and relationships; shared selection
omitted all relationships and seven offices because none had qualifying personnel
or cases. The user approved importing all 11 independently of those qualifications.
