// The Audit the Audit channel's configuration: its identity, its display name,
// and nothing else. Identity is the stable channel id — a handle can be released
// and reassigned, so the handle is provenance and a lookup key only, never what
// selects the channel.
//
// Resolved 2026-10-24 from https://www.youtube.com/@AuditTheAudit, which carries
// `<meta itemprop="identifier">`, `og:url` = /channel/UCc-0YpRpqgA5lPTpSQ5uo-Q,
// and title "Audit the Audit"; round-tripped by fetching
// https://www.youtube.com/channel/UCc-0YpRpqgA5lPTpSQ5uo-Q, which reports
// `vanityChannelUrl` http://www.youtube.com/@AuditTheAudit. Acquire re-resolves
// the handle through the Data API every run and fails when it no longer answers
// with this id.

export const SOURCE_ID = "youtube.audittheaudit";
export const CHANNEL_ID = "UCc-0YpRpqgA5lPTpSQ5uo-Q";
export const CHANNEL_HANDLE = "@AuditTheAudit";
/** The publisher name recorded on every coverage link this source produces. */
export const SOURCE_NAME = "Audit the Audit";
