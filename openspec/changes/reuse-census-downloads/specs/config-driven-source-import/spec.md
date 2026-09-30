## ADDED Requirements

### Requirement: Reuse verified Census ZIPs

Census acquisition SHALL reuse matching selected ZIPs from the current output, previous completed acquisition, or interrupted acquisition. It SHALL compare the remote archive size and central-directory metadata, including entry CRCs, and verify local ZIP entry contents against those checksums before reuse. It SHALL download missing, changed, or damaged files and SHALL log reuse versus download. Historical inputs SHALL remain unchanged.

#### Scenario: Completed acquisition already has matching files

- **WHEN** an earlier completed acquisition contains a matching ZIP
- **THEN** the next acquisition checks it with a range request and copies it into the new output without downloading the full ZIP

#### Scenario: Changed or damaged file

- **WHEN** a file has changed remotely or its local contents fail ZIP integrity validation
- **THEN** acquisition downloads that file and replaces only the current output copy

#### Scenario: New required files

- **WHEN** the selected release adds COUSUB or CONCITY files absent locally
- **THEN** only missing or mismatching ZIPs require full downloads

#### Scenario: Interrupted acquisition from a different vintage

- **WHEN** a resumed output contains ZIPs outside the selected source set
- **THEN** the new output excludes those ZIPs while retaining the original interrupted acquisition

#### Scenario: Download failure

- **WHEN** a download fails or its body is shorter than the declared length
- **THEN** acquisition fails without publishing a partial replacement as a completed ZIP

#### Scenario: Source does not honor range requests

- **WHEN** the source returns the full file to a range request
- **THEN** acquisition uses that returned body without fetching it again
