# YouTube integration fixture review

Run with Node 24 and the installed repository dependencies:

```sh
bash scripts/verify-youtube-stack.sh
```

This command runs deterministic fixtures for all six channels, then TypeScript,
build, and OpenSpec checks. Acquisition tests inject fake HTTP responses and
synthetic agency records. Transform tests use temporary synthetic evidence and
fake match-only resolvers. It does not run intake acquisition or database import.

The integration order is #79 → #76 → #77 → #74 → #75 → #73 → #78.
Each branch contains its predecessor's commit ancestry. The main application
stack (#87 → #89 → #92) and website stack (#35 → #40) remain separate; these
checks do not claim combined application-stack or publication verification.

Review these behaviors in `test/sources/youtube.*`:

- Known channel identities and each source's existing channel checks are retained.
- Each source keeps its existing window and cache policy. Code Blue Cam's
  periodic-refresh factory and LegalEagle's stalest-first rolling factory have
  distinct module names because their policies and evidence formats differ.
- All sources use one officer-candidate extractor and still require a successful
  match at the acquired agency. They do not create people or agencies.
- Unmatched records can be reconsidered; replay determinism, window boundaries,
  and identity failures remain covered by the source fixtures.
- Timedtext acquisition is absent. Code Blue Cam and Donut Operator no longer
  derive officer links from retained captions; PoliceActivity rejects evidence
  containing the disallowed field under its existing strict envelope schema.
- The Data API client and keyed transports reject disallowed hosts before making
  requests. Transport tests use fake responses, including retry/quota cases.

No retained source evidence is rewritten by consolidation. No branches or
worktrees are retired. Exact commit heads and verification results are recorded
in the INS-117 integration manifest. Live channel verification, source accuracy,
and personnel publication remain outside this fixture review.
