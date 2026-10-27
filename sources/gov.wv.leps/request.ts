import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "West Virginia Law Enforcement Professional Standards Subcommittee public-records requests";

export const request = {
  agency: "Law Enforcement Professional Standards Subcommittee",
  state: "West Virginia",
  scope:
    "Statewide agency and officer records held by Law Enforcement Professional Standards Subcommittee for West Virginia, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "Jess.W.Gundy@wv.gov",
    sourceUrl: "https://das.wv.gov/JCS/law-enforcement/Pages/default.aspx",
  },
  historical: [
    {
      id: "csboxi162vro84a7e7p26c49",
      submittedDate: "2026-10-23",
      transport: "portal",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/48",
      notes:
        "Submitted through official JCS contact form addressing LEPS program/subcommittee. Complete standard source prose with state scope and signature, no generated appendix or attachment. Two redaction marker examples have a space after opening angle bracket to satisfy form validation. Text equality verified; successful read-only receipt shows correct hello email and Austin address. Receipt offers Download Submission. Do not duplicate.",
    },
  ],
} satisfies RequestDefinition;
