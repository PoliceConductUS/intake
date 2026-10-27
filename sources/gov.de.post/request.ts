import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "Delaware Police Officer Standards and Training Commission public-records requests";

export const request = {
  agency: "Police Officer Standards and Training Commission",
  state: "Delaware",
  scope:
    "Statewide agency and officer records held by Police Officer Standards and Training Commission for Delaware, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "DSHS_FOIA@delaware.gov",
    sourceUrl: "https://delaware.gov/foia-coordinators/",
  },
  historical: [
    {
      id: "e0m77sldmtzspa1newsnjbq3",
      submittedDate: "2026-10-23",
      transport: "portal",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/7",
      notes:
        "Selected Safety & Homeland Security, as POST official site identifies parent. Entered Dale Lotts, hello@policeconduct.org, Austin address and cost threshold 0. Entered 7386 characters: complete standard source prose with Delaware POST scope and contact signature, no generated appendices or attachment. Text equality verified before submit. Email readback was redacted and equality probe returned false; field value not independently verified, but correct email also included in verified request body. Success page observed after Submit Request. No reference number displayed; do not duplicate.",
    },
  ],
} satisfies RequestDefinition;
