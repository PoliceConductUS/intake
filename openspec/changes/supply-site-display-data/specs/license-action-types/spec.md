## ADDED Requirements

### Requirement: License action types are manual records

Intake SHALL keep two manual-records tables, filled through the manual source. `license_action_type` SHALL hold `name` and `category`, where `category` is one of `discipline`, `commendation` or `other`. `license_action_text` SHALL hold every exact source action text once, each linked to one `license_action_type`. Row IDs SHALL come from the source-name mapping.

#### Scenario: Two source texts collapse to one type

- **WHEN** the texts `Revoked` and `License Revoked` are both linked to the type named `Revoked` with category `discipline`
- **THEN** both texts resolve to the same `license_action_type` row

### Requirement: Every license action links to its type

Every `license_action` row SHALL hold `license_action_type_id`, resolved from its `action` text through `license_action_text`. `license_action.action` SHALL keep the source text.

#### Scenario: Known text

- **WHEN** a TCOLE license action has action text `Suspended`
- **THEN** its `license_action_type_id` is the type linked to `Suspended`

### Requirement: Unknown action text fails generation

When a license action's text has no `license_action_text` row, `data generate` SHALL fail and SHALL name the text, the source namespace and the source record ID.

#### Scenario: New text from a source

- **WHEN** an Oregon DPSST action has text `Emergency Suspension` and no row holds that text
- **THEN** generation fails naming `Emergency Suspension` and the record

### Requirement: The collapse is reviewed before it is written

Before any `license_action_type` row is written, intake SHALL list every distinct source action text from all license action producers with its count, and SHALL propose the smallest set of types with categories for owner review.

#### Scenario: Review list

- **WHEN** the review list is produced
- **THEN** each distinct text appears once with its count, its producers and its proposed type
