import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  DataAnnotation,
  SourceValues,
} from "../src/shared/data-annotations.js";
import {
  TABLE_BY_KIND,
  PRIMARY_KEY_BY_KIND,
} from "../src/shared/io/generated/entity-specs.js";
const output = process.argv[2];
if (!output)
  throw new Error(
    "Supply an output path for the downstream annotation contract.",
  );
await writeFile(
  output,
  JSON.stringify(
    {
      generatedBy: "intake/scripts/publish-data-annotation-contract.ts",
      annotation: z.toJSONSchema(DataAnnotation),
      sourceValues: z.toJSONSchema(SourceValues),
      records: Object.entries(TABLE_BY_KIND).map(([kind, table]) => ({
        kind,
        table,
        primaryKey: PRIMARY_KEY_BY_KIND[kind],
      })),
    },
    null,
    2,
  ) + "\n",
);
