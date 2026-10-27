import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "Arkansas Arkansas Commission on Law Enforcement Standards and Training public-records requests";

export const request = {
  agency: "Arkansas Commission on Law Enforcement Standards and Training",
  state: "Arkansas",
  scope:
    "Statewide agency and officer records held by Arkansas Commission on Law Enforcement Standards and Training for Arkansas, as described in the complete standard public-data request.",
  channel: {
    type: "email",
    to: "Sue.Albritton@dps.arkansas.gov",
    sourceUrl:
      "https://dps.arkansas.gov/law-enforcement/clest/about-clest/staff/",
  },
  historical: [
    {
      id: "vo1e2rq5h9oav7j35ltzmywe",
      submittedDate: "2026-10-23",
      transport: "portal",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/2",
      notes:
        "Submitted official CLEST contact form. Complete standard source prose plus Arkansas agency/officer scope and requester signature, 7349 characters; exact request text verified before submit. No attachment control or generated appendices. Dale Lotts and hello@policeconduct.org entered; correct email and Austin address also in verified body. Success message observed after submission. No reference number; do not duplicate.",
    },
  ],
} satisfies RequestDefinition;
