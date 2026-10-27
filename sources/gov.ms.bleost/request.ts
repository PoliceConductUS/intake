import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "Mississippi Board on Law Enforcement Officer Standards and Training public-records requests";

export const request = {
  agency: "Board on Law Enforcement Officer Standards and Training",
  state: "Mississippi",
  scope:
    "Statewide agency and officer records held by Board on Law Enforcement Officer Standards and Training for Mississippi, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "records@dps.ms.gov",
    sourceUrl: "https://www.sos.ms.gov/adminsearch/ACProposed/00025273b.pdf",
  },
  historical: [
    {
      id: "r0obc7cur086eq2zj4h296m4",
      submittedDate: "2026-10-23",
      transport: "portal",
      reference: "26-3320",
      trackingUrl: "https://mdpsms.nextrequest.com/requests/26-3320",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/24",
      notes:
        "Submitted with user-provided phone 612-208-9601. Account Setup page confirmed email updates to hello@policeconduct.org and linked request 26-3320. Chose Do this later; request page confirms number, access limited until sign-in. Full standard source prose and Mississippi scope submitted; generated appendices not attached because chooser remained disabled. No password entered or established.",
    },
  ],
} satisfies RequestDefinition;
