## ADDED Requirements

### Requirement: Earlier acquires reach a later acquire only through the cache

Intake SHALL NOT hand a source's acquire module the output folders of earlier acquires, and SHALL NOT copy an earlier output into a new acquire's output. An acquire module SHALL NOT read another command's folder. An interrupted acquire SHALL be run again as a new acquire; one whose calls go through the cache takes from the cache every answer that still stands and calls only for the rest.

#### Scenario: An interrupted acquire is run again

- **WHEN** an acquire whose calls go through the cache stops partway and is run again
- **THEN** the new acquire takes from the cache each answer the first one received that still stands, without calling for it
- **AND** it calls only for the rest and writes a complete output into its own command folder
- **AND** the first acquire's command folder is unchanged

### Requirement: The Census, Oregon, Minnesota and Wikipedia acquires make every call through the cache

The Census Gazetteer, Oregon DPSST, Minnesota POST and Wikipedia federal agencies acquires SHALL make every outside call and download through the shared service clients, and SHALL write their output from those answers into their own command folder, under the file names their transforms read.

#### Scenario: The Wikipedia page is cached

- **WHEN** the federal agencies acquire runs within 7 days of the last successful outcome for the list page
- **THEN** the page is not downloaded and `federal-le.html` in the new output is the cached file

### Requirement: The Census, Oregon, Minnesota and Wikipedia acquires refresh an answer after 7 days

Each successful answer of those four acquires SHALL stand for 7 days. The exceptions are a Census ZIP tail, whose successful answer SHALL never stand; a Census ZIP, which SHALL stand until its request changes, or never when its tail does not identify it; and a Minnesota order document, which this requirement does not cover.

#### Scenario: An answer older than 7 days

- **WHEN** one of those four acquires runs more than 7 days after a successful answer it needs, other than a Census tail, a Census ZIP or a Minnesota order document
- **THEN** it makes that call again

### Requirement: The Census, Oregon, Minnesota and Wikipedia acquires do not complete with a missing answer

When one of those four acquires gets an item failure, or a skip for an outage, for a call its output needs, it SHALL make its other calls that do not depend on that answer, then fail naming each failed call with its message and each service whose calls were skipped, with the count and the time to try again. It SHALL NOT be recorded as a completed acquire. Every call is needed but a Minnesota order document the site no longer serves. A failed host check stops the acquire at once.

#### Scenario: A call the output needs fails or is skipped

- **WHEN** one of those four acquires gets an item failure, or a skip for an outage, for a call its output needs
- **THEN** it makes its other calls that do not depend on that answer, then fails naming each failed call and each service whose calls were skipped
- **AND** it is not recorded as a completed acquire

## MODIFIED Requirements

### Requirement: Reuse verified Census ZIPs

Census acquisition SHALL get every Gazetteer page, TIGER listing and source file through the shared file download client, so that each is a call result and each file a binary file in the cache. For each ZIP it SHALL ask for the archive's last 65,557 bytes and its total size with a range request on every acquire, and SHALL then ask for the whole archive with a request that names that tail's SHA-256 and the total size, read from the range answer, or from the whole file when the source ignores the range. Every ZIP depends on every Gazetteer page and TIGER listing, so none is asked when one of them fails or is skipped. A ZIP whose request already has a standing outcome SHALL be taken from the cache without downloading it. A downloaded archive SHALL be kept only when its length is the declared length, its tail hashes to the SHA-256 its request names, and its entries verify against their CRCs. When the tail does not hold the whole central directory, the ZIP SHALL be downloaded on every acquire. Census acquisition SHALL log, for each file, whether it came from the cache or was downloaded. It SHALL write the selected files, and no others, into its own output. Earlier outputs SHALL remain unchanged.

#### Scenario: Completed acquisition already has matching files

- **WHEN** an earlier acquisition, completed or interrupted, downloaded a ZIP and the remote archive's tail and size are unchanged
- **THEN** the next acquisition checks it with a range request and writes the cached file into its output without downloading the ZIP

#### Scenario: Changed or damaged file

- **WHEN** a ZIP's remote tail or size differs from the one an earlier download was asked with
- **THEN** the ZIP is downloaded and written into the output, and the earlier file stays in the cache

#### Scenario: Damaged cached file

- **WHEN** a cached ZIP's bytes no longer hash to its name
- **THEN** the acquisition fails, naming the file

#### Scenario: New required files

- **WHEN** the selected release adds COUSUB or CONCITY files that are not in the cache
- **THEN** only those ZIPs, and any whose tail or size changed, are downloaded

#### Scenario: Interrupted acquisition from a different vintage

- **WHEN** an interrupted acquisition downloaded ZIPs of another vintage and acquisition is run again
- **THEN** the new output holds only the selected vintage's files
- **AND** the other vintage's files stay in the cache and the interrupted acquisition's output is unchanged

#### Scenario: A tail that does not identify its ZIP

- **WHEN** a ZIP's tail does not hold the whole central directory
- **THEN** the ZIP is downloaded on every acquisition

#### Scenario: Download failure

- **WHEN** a download fails, its body is shorter than the declared length, or its entries do not verify, after the client's retries of an outage
- **THEN** acquisition fails, and no whole-ZIP answer is kept in the cache or written into the output for that request

#### Scenario: Source does not honor range requests

- **WHEN** the source returns the full file to a range request
- **THEN** acquisition reads the size and tail from that body and asks for the whole archive with a request that names them
