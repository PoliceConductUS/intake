// Shared US POST (Peace Officer Standards & Training) licensing-authority
// reference. This is a VERIFIED SUBSET, not the full national roster: it is
// intended to grow to the ~55 state/territory POST bodies enumerated by
// IADLEST and the U.S. Army "States' POST" list as a follow-up data task. It is
// deliberately NOT padded with unverified rows — every entry below is a
// well-established public fact (the authority's name, abbreviation, and
// official website). Add a row only when you are confident it is accurate.
//
// `state` is the two-letter USPS code; `location_path_id` is derived at build
// time as `"/" + state.toLowerCase() + "/"` (e.g. TX -> "/tx/").
export const LICENSING_AUTHORITIES: ReadonlyArray<{
  key: string;
  name: string;
  abbreviation: string;
  state: string;
  website: string;
}> = [
  {
    key: "tcole",
    name: "Texas Commission on Law Enforcement",
    abbreviation: "TCOLE",
    state: "TX",
    website: "https://www.tcole.texas.gov",
  },
  {
    key: "azpost",
    name: "Arizona Peace Officer Standards and Training Board",
    abbreviation: "AZ POST",
    state: "AZ",
    website: "https://post.az.gov",
  },
  {
    key: "capost",
    name: "California Commission on Peace Officer Standards and Training",
    abbreviation: "CA POST",
    state: "CA",
    website: "https://post.ca.gov",
  },
  {
    key: "mnpost",
    name: "Minnesota Board of Peace Officer Standards and Training",
    abbreviation: "MN POST",
    state: "MN",
    website: "https://dps.mn.gov/entity/post",
  },
];
