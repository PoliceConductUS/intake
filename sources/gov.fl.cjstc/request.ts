import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "Florida Criminal Justice Standards & Training Commission public-records requests";

export const request = {
  agency: "Criminal Justice Standards & Training Commission",
  state: "Florida",
  scope:
    "Statewide agency and officer records held by Criminal Justice Standards & Training Commission for Florida, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "publicrecords@fdle.state.fl.us",
    sourceUrl: "https://www.fdle.state.fl.us/about-fdle/contact-us",
  },
  historical: [
    {
      id: "ah53z35n7p4ojnmfqab2jmit",
      submittedDate: "2026-10-23",
      transport: "portal",
      reference: "GRR-2026-5434",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/8",
      notes:
        "Submitted status, request body, hello@policeconduct.org, Austin address verified on request-detail page. Requested Documents table says No documents have been added; attachment receipt remains unverified. Do not duplicate request.",
    },
  ],
} satisfies RequestDefinition;
