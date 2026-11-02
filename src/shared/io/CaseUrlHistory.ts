import { stat } from "node:fs/promises";
import { z } from "zod";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";
const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("CaseUrlHistory"),
    metadata: z
      .object({ name: z.literal("case-urls"), namespace: z.literal("intake") })
      .strict(),
    spec: z
      .object({
        aliases: z.array(
          z
            .object({
              oldPath: z
                .string()
                .regex(/^\/civil-(cases|litigation)\/[a-z0-9/-]+\/$/),
              caseId: z.string().min(1),
              evidence: z.string().min(1),
              recordedAt: z.string().datetime(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.spec.aliases.map((a) => a.oldPath)).size ===
      value.spec.aliases.length,
    "Duplicate historical URL.",
  );
export type CaseUrlHistoryEnvelope = z.infer<typeof schema>;
export const CaseUrlHistory = {
  schema,
  new(
    aliases: CaseUrlHistoryEnvelope["spec"]["aliases"],
  ): CaseUrlHistoryEnvelope {
    return schema.parse({
      apiVersion: INTAKE_API_VERSION,
      kind: "CaseUrlHistory",
      metadata: { name: "case-urls", namespace: "intake" },
      spec: { aliases },
    });
  },
  async readDirectory(
    dir: string,
  ): Promise<CaseUrlHistoryEnvelope | undefined> {
    const file = yamlResourcePath(dir, this.new([]));
    try {
      await stat(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    return schema.parse(
      (await readYamlDocumentFile(file, "CaseUrlHistory")).document,
    );
  },
  async write(dir: string, input: CaseUrlHistoryEnvelope): Promise<void> {
    const parsed = schema.parse(input);
    await writeYamlDocumentFile(yamlResourcePath(dir, parsed), parsed);
  },
};
