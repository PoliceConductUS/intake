import { expect, test } from "vitest";
import {
  ReviewLinkSpec,
  FK_REFERENCES,
  importTypeMetadata,
} from "../src/shared/io/generated/entity-specs.js";

test("report links accept a case relationship without a copied title or URL", () => {
  const record = {
    id: "report-case-link",
    review_id: "report",
    civil_case_id: "case",
    title: null,
    url: null,
  };
  expect(ReviewLinkSpec.parse(record)).toEqual(record);
  expect(FK_REFERENCES.ReviewLink).toContainEqual({
    field: "civil_case_id",
    targetKind: "CivilCase",
  });
  expect(importTypeMetadata.ReviewLinks.dependsOn).toContain("CivilCases");
});
