import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { Artifacts } from "../../../src/shared/io/index.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import { readImportArtifacts } from "../../../src/cli/import/artifacts/artifacts-reader.js";

test("reading agency artifacts preserves source city spellings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "source-city-"));
  try {
    const cities = ["Meridan", "Belleville", "Lapryor"];
    const written = await Artifacts.write(
      directory,
      buildArtifactsEnvelope("gov.tx.tcole", "test", {
        artifacts: [
          {
            kind: "Agencies",
            records: Object.fromEntries(
              cities.map((city) => [
                city,
                { spec: { name: `${city} Police`, city, state: "TX" } },
              ]),
            ),
          },
        ],
      }),
    );
    const { artifacts, artifactMutation } = await readImportArtifacts(
      written.path,
    );
    const records = artifacts.spec.artifacts[0].spec.records;
    for (const city of cities)
      expect(records[city]).toMatchObject({ spec: { city } });
    expect(artifactMutation).toEqual({ applied: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
