import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "Wisconsin Law Enforcement Standards Board public-records requests";

export const request = {
  agency: "Law Enforcement Standards Board",
  state: "Wisconsin",
  scope:
    "Statewide agency and officer records held by Law Enforcement Standards Board for Wisconsin, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "opengov@wisdoj.gov",
    sourceUrl: "https://www.wisdoj.gov/Pages/AboutUs/request-records.aspx",
  },
  historical: [
    {
      id: "b3u3cof3piuruiuygpnojg0d",
      submittedDate: "2026-10-23",
      transport: "portal",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/47",
      notes:
        "Standard request text entered in Inquiry (7360 characters including Wisconsin scope and signature). No attachment field. Correct email, Austin street address, Texas and ZIP verified before submission.",
    },
  ],
} satisfies RequestDefinition;
