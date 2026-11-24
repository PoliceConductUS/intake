import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { Artifacts } from "../../../src/shared/io/index.js";
import { Artifacts as RawArtifacts } from "../../../src/shared/io/generated/Artifacts.js";
import {
  INTAKE_API_VERSION,
  importArtifactKindOrder,
} from "../../../src/shared/io/import-types.js";
import { importTypeMetadata } from "../../../src/shared/io/import-type-metadata.js";
import { validateArtifactRecords } from "../../../src/cli/import/artifacts/validate-artifact-records.js";
import { DatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutations.js";

const metadata = { name: "case-link", namespace: "test" };
const directories: string[] = [];
afterAll(async () => {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});
async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), "review-case-links-"));
  directories.push(value);
  return value;
}
function artifact(
  spec: Record<string, unknown>,
  action?: "PATCH",
): Parameters<typeof Artifacts.write>[1] {
  return {
    apiVersion: INTAKE_API_VERSION,
    kind: "Artifacts" as const,
    metadata,
    spec: {
      artifacts: [
        {
          kind: "ReviewLinks" as const,
          spec: {
            records: {
              "case-link": {
                spec,
                ...(action === undefined ? {} : { metadata: { action } }),
              },
            },
          },
        },
      ],
    },
  };
}
function mutation(spec: Record<string, unknown>) {
  return {
    metadata,
    spec: {
      mutations: [
        { kind: "ReviewLinkCreate" as const, name: "case-link", spec },
      ],
    },
  };
}

test.each([
  { civil_case_id: "case", url: null, title: null },
  { civil_case_id: "case" },
  { url: "https://example.invalid/evidence", title: "Evidence" },
])(
  "canonical artifact and mutation IO roundtrip a valid target: %j",
  async (target) => {
    const spec = { id: "existing-link", review_id: "report", ...target };
    const writtenArtifact = await Artifacts.write(
      await directory(),
      artifact(spec),
    );
    expect(
      (await Artifacts.read(writtenArtifact.path)).spec.artifacts[0]?.spec
        .records["case-link"],
    ).toMatchObject({ spec });
    const writtenMutation = await DatabaseMutations.write(
      await directory(),
      DatabaseMutations.new(mutation(spec)),
    );
    expect(
      (await DatabaseMutations.read(writtenMutation.path)).spec.mutations,
    ).toEqual([{ kind: "ReviewLinkCreate", name: "case-link", spec }]);
  },
);

test.each([
  {},
  { url: "https://example.invalid/partial" },
  { title: "Partial" },
  {
    civil_case_id: "case",
    url: "https://example.invalid/mixed",
    title: "Mixed",
  },
  { civil_case_id: "case", url: "https://example.invalid/mixed" },
  { civil_case_id: "case", title: "Mixed" },
])(
  "canonical artifact and mutation IO reject invalid targets: %j",
  async (target) => {
    const spec = { id: "existing-link", review_id: "report", ...target };
    await expect(
      Artifacts.write(await directory(), artifact(spec)),
    ).rejects.toThrow(/malformed/);
    expect(() => DatabaseMutations.new(mutation(spec))).toThrow(/malformed/);
  },
);

test("case records are imported before report links that reference them", () => {
  expect(importTypeMetadata.ReviewLinks.dependsOn).toContain("CivilCases");
  const order = importArtifactKindOrder();
  expect(order.indexOf("CivilCases")).toBeLessThan(
    order.indexOf("ReviewLinks"),
  );
});

test("partial link corrections retain PATCH semantics", async () => {
  const envelope = artifact({ title: "Revised evidence title" }, "PATCH");
  const written = await Artifacts.write(await directory(), envelope);
  expect(
    (await Artifacts.read(written.path)).spec.artifacts[0]?.spec.records[
      "case-link"
    ],
  ).toMatchObject({
    metadata: { action: "PATCH" },
    spec: { title: "Revised evidence title" },
  });
});

test("recorded link updates can clear URL and title and set the case reference", async () => {
  const source = {
    namespace: "test",
    command: { name: "update-case-link" },
    kind: "ReviewLink",
    name: "case-link",
  };
  const operations = [
    {
      action: "set",
      path: "url",
      from: "https://example.invalid/evidence",
      to: null,
      reason: "Link to stored case",
      source,
    },
    {
      action: "set",
      path: "title",
      from: "Evidence",
      to: null,
      reason: "Use current case title",
      source,
    },
    {
      action: "set",
      path: "civil_case_id",
      from: null,
      to: "case",
      reason: "Link to stored case",
      source,
    },
  ];
  const written = await DatabaseMutations.write(
    await directory(),
    DatabaseMutations.new({
      metadata,
      spec: {
        mutations: [
          { kind: "ReviewLinkUpdate", name: "case-link", spec: { operations } },
        ],
      },
    }),
  );
  expect(
    (await DatabaseMutations.read(written.path)).spec.mutations,
  ).toMatchObject([
    {
      kind: "ReviewLinkUpdate",
      name: "case-link",
      spec: { operations },
    },
  ]);
});

test("resolved inline PATCH records retain partial target corrections", async () => {
  const written = await RawArtifacts.write(
    await directory(),
    artifact({ title: "Revised evidence title" }, "PATCH"),
  );
  expect(
    (await Artifacts.read(written.path)).spec.artifacts[0]?.spec.records[
      "case-link"
    ],
  ).toMatchObject({
    metadata: { action: "PATCH" },
    spec: { title: "Revised evidence title" },
  });
});

test("generation validates partial case-link corrections before mutation planning", async () => {
  const written = await Artifacts.write(
    await directory(),
    artifact({ title: "Revised evidence title" }, "PATCH"),
  );
  const resolved = await Artifacts.read(written.path);
  expect(() => validateArtifactRecords(resolved)).not.toThrow();
});
