import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { PersonnelCreate } from "../../../src/cli/import/artifacts/io/generated-mutations/PersonnelCreate.js";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";
import { SourceNameToCanonicalId } from "../../../src/cli/state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
import { Command } from "../../../src/shared/io/Command.js";
import { read as readLocationPaths } from "../../../src/shared/io/generated/LocationPaths.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";

type EnvelopeReader = (filePath: string) => Promise<unknown>;

async function tempFile(contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "intake-envelope-"));
  const filePath = path.join(directory, "envelope.yaml");
  await writeFile(filePath, contents);
  return filePath;
}

async function expectMalformedRead(
  envelopeName: string,
  contents: string,
  read: EnvelopeReader,
): Promise<void> {
  const filePath = await tempFile(contents);
  await expect(read(filePath)).rejects.toThrow(`${envelopeName} is malformed`);
}

describe("canonical envelope IO strictness", () => {
  test("rejects wrong apiVersion through read operations", async () => {
    await expectMalformedRead(
      "Command",
      [
        "apiVersion: policeconduct.org/v1",
        "kind: Command",
        "metadata:",
        "  name: test-command",
        "  namespace: intake",
        "spec:",
        "  statePath: ../state",
        "  path: .",
        "  sharedIoRoot: /tmp/intake/dist/shared/io",
        "  args: []",
      ].join("\n"),
      Command.read,
    );
  });

  test("rejects wrong kind through read operations", async () => {
    await expectMalformedRead(
      "LocationPaths",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: LocationPath",
        "metadata:",
        "  name: paths",
        "  namespace: mn-post",
        "spec:",
        "  records: {}",
      ].join("\n"),
      (filePath) => readLocationPaths(filePath, { raw: true }),
    );
  });

  test("rejects spec keys outside the exact shared artifact schema", async () => {
    await expectMalformedRead(
      "LocationPaths",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: LocationPaths",
        "metadata:",
        "  name: paths",
        "  namespace: mn-post",
        "spec:",
        "  records: {}",
        "  unexpected: true",
      ].join("\n"),
      (filePath) => readLocationPaths(filePath, { raw: true }),
    );
  });

  test("rejects spec keys outside the exact mutation schema", async () => {
    await expectMalformedRead(
      "PersonnelCreate",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: PersonnelCreate",
        "metadata:",
        "  name: personnel-1",
        "  namespace: mn-post",
        "spec:",
        "  id: personnel-1",
        "  first_name: Ada",
        "  last_name: Lovelace",
        "  slug: ada-lovelace",
        "  officer_canonical_id: old-name",
      ].join("\n"),
      PersonnelCreate.read,
    );
  });

  test("rejects spec keys outside the exact DatabaseMutations schema", async () => {
    await expectMalformedRead(
      "DatabaseMutations",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: DatabaseMutations",
        "metadata:",
        "  name: database-mutations",
        "  namespace: mn-post",
        "spec:",
        "  mutations: []",
        "  commands: []",
      ].join("\n"),
      (filePath) => DatabaseMutations.read(filePath, { raw: true }),
    );
  });

  test("rejects spec keys outside the exact source-name mapping schema", async () => {
    await expectMalformedRead(
      "SourceNameToCanonicalId",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: SourceNameToCanonicalId",
        "metadata:",
        "  name: agency-1",
        "  namespace: mn-post",
        "spec:",
        "  kind: Agency",
        "  canonicalId: agency-canonical-1",
        "  slug: agency-one",
      ].join("\n"),
      SourceNameToCanonicalId.read,
    );
  });

  test("rejects spec keys outside the exact resolved-property schema", async () => {
    await expectMalformedRead(
      "ResolvedProperty",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: ResolvedProperty",
        "metadata:",
        "  name: agency-location",
        "  namespace: intake",
        "spec:",
        "  subject:",
        `    apiVersion: ${INTAKE_API_VERSION}`,
        "    kind: Agency",
        "    name: agency-1",
        "  targetProperty: location_path_id",
        "  sources:",
        "    mn-post:",
        "      kind: Agency",
        "      name: source-agency-1",
        "      inputFingerprint: abc123",
        "  value: /mn/",
        "  confidence: 1",
      ].join("\n"),
      ResolvedProperty.read,
    );
  });
});
