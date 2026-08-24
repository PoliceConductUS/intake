import { describe, it, expect } from "vitest";
import {
  consumesOf,
  planSourceOrder,
  topologicalOrder,
} from "../../../src/cli/run/source-order.js";
import type { ImportArtifactKind } from "../../../src/shared/io/index.js";

// Expected values below are hand-derived from the FK graph (FK_REFERENCES),
// computed independently of source-order.ts (see ADR 0021 and the design doc).

describe("consumesOf", () => {
  it("derives a civil-case source's direct FK targets, not the transitive closure", () => {
    const produces: ImportArtifactKind[] = [
      "CivilCases",
      "CivilCaseOfficers",
      "CivilCaseLinks",
    ];
    // CivilCaseOfficers → AgencyPersonnel; CivilCases → LocationPaths.
    // Agency/Personnel sit one hop below AgencyPersonnel: transitive, excluded.
    expect(new Set(consumesOf(produces))).toEqual(
      new Set(["LocationPaths", "AgencyPersonnel"]),
    );
  });

  it("excludes kinds the source itself produces", () => {
    // Census produces the whole location-path cluster, so it consumes nothing.
    expect(
      consumesOf([
        "LocationPaths",
        "LocationPathGeometries",
        "LocationPathAliases",
      ]),
    ).toEqual([]);
  });

  it("derives a roster source's consumed set as just LocationPaths", () => {
    const produces: ImportArtifactKind[] = [
      "LicensingAuthorities",
      "Agencies",
      "Personnel",
      "Licenses",
      "LicenseActions",
      "AgencyPersonnel",
      "AgencyPhoneNumbers",
    ];
    // Agency/LicensingAuthority FK LocationPath; every other FK target
    // (Agency, License, Personnel, LicensingAuthority) is produced here.
    expect(consumesOf(produces)).toEqual(["LocationPaths"]);
  });
});

describe("planSourceOrder", () => {
  it("places a producer before its consumer", () => {
    const { order } = planSourceOrder([
      { id: "roster", produces: ["Agencies"] },
      { id: "census", produces: ["LocationPaths"] },
    ]);
    expect(order).toEqual(["census", "roster"]);
  });

  it("orders the eight real sources so every producer precedes its consumers", () => {
    const { order } = planSourceOrder([
      {
        id: "courtlistener",
        produces: ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"],
      },
      {
        id: "clearinghouse-api",
        produces: ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"],
      },
      {
        id: "gov.us.federal-le",
        produces: ["FederalAgencies", "Agencies", "FederalAgencyBranches"],
      },
      { id: "gov.azpost.roster", produces: ["Personnel"] },
      {
        id: "mn-post",
        produces: [
          "LicensingAuthorities",
          "Agencies",
          "Personnel",
          "Licenses",
          "AgencyPersonnel",
          "Disciplines",
          "DisciplineAgencyOfficers",
          "CoverageLinks",
          "CoverageLinkAgencyOfficers",
        ],
      },
      {
        id: "gov.tx.tcole",
        produces: [
          "LicensingAuthorities",
          "Agencies",
          "Personnel",
          "Licenses",
          "LicenseActions",
          "AgencyPersonnel",
          "AgencyPhoneNumbers",
        ],
      },
      {
        id: "us-census-gazetteer",
        produces: [
          "LocationPaths",
          "LocationPathGeometries",
          "LocationPathAliases",
        ],
      },
    ]);
    expect(order).toEqual([
      "us-census-gazetteer",
      "gov.tx.tcole",
      "mn-post",
      "clearinghouse-api",
      "courtlistener",
      "gov.azpost.roster",
      "gov.us.federal-le",
    ]);
  });

  it("is stable regardless of input order", () => {
    const sources = [
      { id: "census", produces: ["LocationPaths"] as ImportArtifactKind[] },
      {
        id: "tx",
        produces: [
          "Agencies",
          "AgencyPersonnel",
          "Personnel",
          "Licenses",
          "LicensingAuthorities",
        ] as ImportArtifactKind[],
      },
      {
        id: "civil",
        produces: [
          "CivilCases",
          "CivilCaseOfficers",
          "CivilCaseLinks",
        ] as ImportArtifactKind[],
      },
    ];
    const forward = planSourceOrder(sources).order;
    const reversed = planSourceOrder([...sources].reverse()).order;
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(["census", "tx", "civil"]);
  });

  it("runs a single consumer alone with no producer in the set", () => {
    const { order } = planSourceOrder([
      {
        id: "courtlistener",
        produces: ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"],
      },
    ]);
    expect(order).toEqual(["courtlistener"]);
  });

  it("exposes the edge that forced each precedence", () => {
    const { edges } = planSourceOrder([
      { id: "census", produces: ["LocationPaths"] },
      {
        id: "civil",
        produces: ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"],
      },
    ]);
    expect(edges).toContainEqual({
      before: "census",
      after: "civil",
      kind: "LocationPaths",
    });
  });
});

describe("topologicalOrder", () => {
  it("throws on a cycle, naming the nodes and edge labels", () => {
    expect(() =>
      topologicalOrder(
        ["A", "B"],
        [
          { before: "A", after: "B", label: "x" },
          { before: "B", after: "A", label: "y" },
        ],
      ),
    ).toThrow(/cycle among A, B.*A → B \(x\).*B → A \(y\)/s);
  });

  it("breaks ties by descending out-degree, then id", () => {
    // hub → a, hub → b; leaf independent. hub (out-degree 2) leads; among the
    // out-degree-0 nodes a, b, leaf, id order wins.
    const order = topologicalOrder(
      ["leaf", "b", "a", "hub"],
      [
        { before: "hub", after: "a" },
        { before: "hub", after: "b" },
      ],
    );
    expect(order).toEqual(["hub", "a", "b", "leaf"]);
  });
});
