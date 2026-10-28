import { replaceSourceExclusions } from "../../../src/shared/data-annotations.js";
import { expect, test } from "vitest";
import { attachExclusionEvidence } from "../../../src/cli/transform/exclusion-annotations.js";
import { inspectDataAnnotations } from "../../../src/shared/inspect-data-annotations.js";
import type { SourceManifest } from "../../../src/cli/transform/source-transform.js";
const manifest = (): SourceManifest => ({
  artifacts: [
    {
      kind: "LicensingAuthorities",
      records: {
        board: {
          spec: { name: "Test board", source_namespaces: ["test.provider"] },
        },
      },
    },
  ],
});
const excluded = new Map([
  [
    "Agency:bad",
    { kind: "Agency", key: "bad", reason: "Unresolvable geography" },
  ],
]);
test("explicit exclusion evidence attaches to its authority and retains the source key and reason", () => {
  const result = attachExclusionEvidence(manifest(), excluded, "test.provider");
  const spec = result.artifacts[0].records.board.spec as Record<
    string,
    unknown
  >;
  expect(spec.source_exclusions).toEqual({
    "test.provider": [
      { kind: "Agency", key: "bad", reason: "Unresolvable geography" },
    ],
  });
  expect(
    inspectDataAnnotations("LicensingAuthority", spec, {}, new Date()),
  ).toContainEqual({
    type: "warning",
    field: "excluded_records",
    value: { kind: "Agency", key: "bad" },
    source_namespace: "test.provider",
    source_record_id: "bad",
    message: "Explicitly excluded Agency: Unresolvable geography",
  });
});
test("empty source exclusions are emitted to clear earlier evidence on rerun", () => {
  const result = attachExclusionEvidence(
    manifest(),
    new Map(),
    "test.provider",
  );
  expect(result.artifacts[0].records.board.spec).toMatchObject({
    source_exclusions: { "test.provider": [] },
  });
});
test("exclusions fail loudly without exactly one explicit provider authority", () => {
  expect(() =>
    attachExclusionEvidence({ artifacts: [] }, excluded, "test.provider"),
  ).toThrow(/exactly one/);
  const duplicate = manifest();
  duplicate.artifacts.push(...manifest().artifacts);
  expect(() =>
    attachExclusionEvidence(duplicate, excluded, "test.provider"),
  ).toThrow(/exactly one/);
});

test("rerun clears only its provider, retaining other providers", () => {
  expect(
    replaceSourceExclusions(
      {
        a: [{ kind: "Agency", key: "x", reason: "bad geography" }],
        b: [{ kind: "Agency", key: "y", reason: "documented exclusion" }],
      },
      { a: [] },
    ),
  ).toEqual({
    a: [],
    b: [{ kind: "Agency", key: "y", reason: "documented exclusion" }],
  });
});

test("explicit record ownership supports mixed manual sources without claiming the namespace", () => {
  const input = manifest();
  input.artifacts[0].records.board.spec = {
    name: "Test board",
    source_namespaces: ["test.provider"],
    source_exclusions: {
      manual: [{ kind: "Agency", key: "bad", reason: "previous reason" }],
    },
  };
  const result = attachExclusionEvidence(input, excluded, "manual");
  expect(result.artifacts[0].records.board.spec).toMatchObject({
    source_namespaces: ["test.provider"],
    source_exclusions: { manual: [...excluded.values()] },
  });
  expect(
    attachExclusionEvidence(input, new Map(), "manual").artifacts[0].records
      .board.spec,
  ).toMatchObject({ source_exclusions: { manual: [] } });
  const unassigned = new Map([
    ...excluded,
    [
      "Agency:another",
      { kind: "Agency", key: "another", reason: "another exclusion" },
    ],
  ]);
  expect(() => attachExclusionEvidence(input, unassigned, "manual")).toThrow(
    /exactly one/,
  );
  const duplicate = structuredClone(input);
  duplicate.artifacts[0].records.other = structuredClone(
    input.artifacts[0].records.board,
  );
  expect(() => attachExclusionEvidence(duplicate, excluded, "manual")).toThrow(
    /exactly one/,
  );
});
