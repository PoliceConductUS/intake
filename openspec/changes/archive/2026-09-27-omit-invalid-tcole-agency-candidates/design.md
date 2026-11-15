# Design

Validate buildAgencies candidates with AgencySpec from canonical shared IO. Omit an invalid candidate and log its source ID and invalid fields. Existing assignment/contact construction only emits references to agencies present in that map. Keep personnel candidates for shared selection.

Use shared field-level Zod validators through generated Agency specs so singular/plural artifacts, creates, and property updates share validation. Keep generator metadata declarative; do not add source or ID branches. Preserve the existing optional artifact versus required create distinction.
