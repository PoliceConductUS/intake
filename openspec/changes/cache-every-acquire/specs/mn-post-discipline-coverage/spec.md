## ADDED Requirements

### Requirement: Every call of the MN POST acquire goes through the cache

The MN POST acquire SHALL get the statistics page, the agency CSV, each agency search, each agency roster, each license search and each officer's details through the shared file download client. It SHALL open the browser only when a call the cache does not answer is made, and SHALL use the browser session only inside such a call. It SHALL NOT read the agency CSV, a roster, a detail or a discipline request file already in its output to skip a call.

#### Scenario: Every answer is cached

- **WHEN** the acquire runs and every call it needs has a standing call result
- **THEN** it opens no browser and writes the same rosters, details and discipline request files as the run that received those answers

#### Scenario: An interrupted acquire is run again

- **WHEN** the acquire stopped after collecting some rosters and details, and is run again
- **THEN** those rosters and details are taken from the cache, and only the rest are requested

### Requirement: A bot challenge is never kept as an answer

The MN POST acquire SHALL keep a statistics page or agency CSV answer only when it is not a bot challenge.

#### Scenario: A bot challenge instead of the statistics page or the CSV

- **WHEN** the statistics page or the agency CSV answers with a bot challenge
- **THEN** the answer is not kept, the call is retried and then skipped as an outage, and the acquire fails naming the service in its skip line

#### Scenario: A failed agency search

- **WHEN** the site search for an agency that `agencies.yaml` does not hold fails or is skipped
- **THEN** the agency is not reported as unresolved, and the acquire fails naming the call

### Requirement: An Apex action request names the action, not the session

A request for Apex actions SHALL name each action's class, method and parameters, and SHALL NOT hold the Aura context, the Aura token, an action ID, the request counter or a cookie. An officer's details for one license, the four actions for that officer and license, SHALL be one call result, used by both roster collection and discipline collection. A response SHALL be kept only when every action in it succeeded and every record count equals the rows returned.

#### Scenario: One officer on a roster and in the discipline workbook

- **WHEN** an officer's details were fetched for an agency roster and the discipline workbook names the same officer and license
- **THEN** no second detail request is made for that officer and license

#### Scenario: A failed Apex action

- **WHEN** an action in an Aura response did not succeed, or a record count differs from the rows returned
- **THEN** the response is not kept as an answer and the acquire fails naming the call
