## MODIFIED Requirements

### Requirement: The downloads of one URL can be listed

The call result for a download request whose answer is a file SHALL keep one outcome per download made for that request, each with the time and the SHA-256 of the file received. Each such call result SHALL name the URL in its request, so that the files downloaded from a URL can be listed by date from the call results that name it, and each fetched by its SHA-256. One URL can have several requests, told apart by their operation and parameters.

#### Scenario: A URL serves a different file later

- **WHEN** a URL is downloaded twice and the second file differs from the first
- **THEN** both downloads are outcomes, with their times and SHA-256s, of call results whose request names that URL
- **AND** both files are in the cache

#### Scenario: A URL serves the same file again

- **WHEN** a URL is downloaded again with the same request and the file's SHA-256 is unchanged
- **THEN** the new outcome names the same file and no second copy is stored
