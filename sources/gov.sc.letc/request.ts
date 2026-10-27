import type { RequestDefinition } from "../../src/cli/requests/lifecycle.js";

export const description =
  "South Carolina South Carolina Law Enforcement Training Council public-records requests";

export const request = {
  agency: "South Carolina Law Enforcement Training Council",
  state: "South Carolina",
  scope:
    "Statewide agency and officer records held by South Carolina Law Enforcement Training Council for South Carolina, as described in the complete standard public-data request.",
  channel: {
    type: "portal",
    url: "https://www.cognitoforms.com/SCCriminalJusticeAcademy/FOIARequest",
    sourceUrl: "https://sccja.sc.gov/freedom-of-information-act/",
  },
  historical: [
    {
      id: "mer21nfmt995ja3le62x8e6j",
      submittedDate: "2026-10-23",
      transport: "portal",
      evidence: "records-requests/2026-10-23-state-post/status.json#/states/39",
      notes:
        "Submitted with provided phone, hello email, Austin address, Texas, and Other documents selected. Exact 7439-character standard source prose and statewide agency/officer scope verified before submission. No attachment control; generated appendices not included. Confirmation shown; no reference number provided.",
    },
  ],
} satisfies RequestDefinition;

// Field identities and confirmation text observed on the official form.
export const portalForm = {
  url: "https://www.cognitoforms.com/SCCriminalJusticeAcademy/FOIARequest",
  actions: [
    {
      type: "fill",
      target: { selector: "#cog-input-auto-0" },
      field: "firstName",
    },
    {
      type: "fill",
      target: { selector: "#cog-input-auto-1" },
      field: "lastName",
    },
    { type: "fill", target: { label: "Email (required)" }, field: "email" },
    { type: "fill", target: { label: "Phone (required)" }, field: "phone" },
    { type: "fill", target: { selector: "#cog-5" }, field: "organization" },
    { type: "fill", target: { selector: "#cog-6-line1" }, field: "street" },
    { type: "fill", target: { selector: "#cog-6-city" }, field: "city" },
    { type: "click", target: { selector: "#cog-6-state" } },
    { type: "click", target: { role: "option", name: "Texas" } },
    { type: "fill", target: { selector: "#cog-6-zip-code" }, field: "zip" },
    { type: "click", target: { label: "Other" } },
    { type: "fill", target: { selector: "#cog-14" }, field: "requestText" },
  ],
  submit: { role: "button", name: "Submit" },
  successText:
    "Thank you for filling out the form. Your response has been recorded.",
  blockers: [],
} satisfies import("../../src/cli/requests/portal.js").PortalForm;
