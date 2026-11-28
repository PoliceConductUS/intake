import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toJSONSchema } from "zod";
import { intakeWorkspace } from "../src/cli/command-directory.js";
import {
  INTAKE_API_VERSION,
  importArtifactKindOrder,
  importTypeRegistry,
} from "../src/shared/io/import-types.js";

const workspace = intakeWorkspace(process.env);

const outputDirectory = path.join(
  workspace,
  "intake",
  "schemas",
  INTAKE_API_VERSION,
);
await mkdir(outputDirectory, { recursive: true });

const index = {
  apiVersion: INTAKE_API_VERSION,
  importOrder: importArtifactKindOrder(),
  schemas: Object.fromEntries(
    Object.values(importTypeRegistry).map((definition) => [
      definition.kind,
      {
        path: `${definition.kind}.schema.json`,
        entityName: definition.entityName,
        targetTable: definition.targetTable ?? null,
        dependsOn: definition.dependsOn,
      },
    ]),
  ),
};

await writeFile(
  path.join(outputDirectory, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
);

for (const definition of Object.values(importTypeRegistry)) {
  await writeFile(
    path.join(outputDirectory, `${definition.kind}.schema.json`),
    `${JSON.stringify(toJSONSchema(definition.recordSchema), null, 2)}\n`,
  );
}

console.log(`Published import schemas to ${outputDirectory}`);
