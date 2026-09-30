# Design

The actual source ZIP 551554047 is compact ZIP+4, not a reason to omit the agency. Format exactly nine digits as 55155-4047 before emitting the agency; preserve leading zeros. Five-digit and already hyphenated values remain unchanged. Malformed and placeholder values continue to fail canonical validation. This is lossless source formatting; no inferred postal digits, schema relaxation, fallback, or raw-file mutation.
