import { z } from "zod";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { ResolvedProperty } from "../../cli/state/resolved-property/ResolvedProperty.js";
import { PropertyCorrection } from "./PropertyCorrection.js";
import { yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";
const text = z.string().min(1);
export const caseSlugRowSchema = z
  .object({
    id: text,
    title: text,
    cause_number: text,
    primary_source_url: z.string().url(),
    court: text,
    filed_date: text,
    full_citation: z.string().nullable(),
    citation_source_url: z.string().nullable(),
    slug: text,
    state: text,
  })
  .strict();
const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("CaseSlugMigration"),
    metadata: z
      .object({
        name: text,
        namespace: z.literal("intake"),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: z
      .object({
        policy: z.literal("indigo-full-or-labelled-docket-v1"),
        evidence: text,
        recordedAt: z.string().datetime(),
        rows: z.array(
          z
            .object({
              id: text,
              before: caseSlugRowSchema,
              newSlug: text,
              citation: text,
              oldPaths: z.array(text),
              cacheBefore: ResolvedProperty.schema.nullable(),
              cacheAfter: ResolvedProperty.schema,
            })
            .strict(),
        ),
        corrections: z.array(
          z
            .object({
              before: PropertyCorrection.schema,
              after: PropertyCorrection.schema,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((event, ctx) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    const paths = new Set<string>();
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const row of event.spec.rows) {
      if (ids.has(row.id) || slugs.has(row.newSlug))
        invalid("Duplicate case ID or citation slug.");
      ids.add(row.id);
      slugs.add(row.newSlug);
      if (row.id !== row.before.id) invalid("Case identity changed.");
      for (const cache of [row.cacheBefore, row.cacheAfter]) {
        if (
          cache &&
          (cache.spec.subject.kind !== "CivilCase" ||
            cache.spec.subject.name !== row.id ||
            cache.spec.targetProperty !== "slug" ||
            cache.metadata.name !==
              `${INTAKE_API_VERSION}:CivilCase:${row.id}:slug`)
        )
          invalid("Slug cache targets another identity or property.");
      }
      const active = row.cacheAfter.spec.entries.filter(
        (e) => e.inputFingerprint === undefined,
      );
      if (active.length !== 1 || active[0]?.value !== row.newSlug)
        invalid("Canonical cache must contain the new slug.");
      for (const oldPath of row.oldPaths) {
        if (paths.has(oldPath) || oldPath === `/civil-cases/${row.newSlug}/`)
          invalid("Duplicate or self-referencing historical URL.");
        paths.add(oldPath);
      }
    }
    for (const { before, after } of event.spec.corrections) {
      if (
        before.spec.subject.kind !== "CivilCase" ||
        before.spec.targetProperty !== "slug" ||
        JSON.stringify(before.metadata) !== JSON.stringify(after.metadata) ||
        JSON.stringify(before.spec.subject) !==
          JSON.stringify(after.spec.subject) ||
        after.spec.targetProperty !== "slug"
      )
        invalid("Correction identity or property changed.");
    }
  });
export type CaseSlugMigrationEnvelope = z.infer<typeof schema>;
export type CaseSlugRow = z.infer<typeof caseSlugRowSchema>;
export const CaseSlugMigration = {
  schema,
  new(
    input: Omit<CaseSlugMigrationEnvelope, "apiVersion" | "kind">,
  ): CaseSlugMigrationEnvelope {
    return schema.parse({
      apiVersion: INTAKE_API_VERSION,
      kind: "CaseSlugMigration",
      ...input,
    });
  },
  async read(file: string): Promise<CaseSlugMigrationEnvelope> {
    return schema.parse(
      (await readYamlDocumentFile(file, "CaseSlugMigration")).document,
    );
  },
  async write(
    dir: string,
    input: CaseSlugMigrationEnvelope,
  ): Promise<{ path: string }> {
    const parsed = schema.parse(input);
    const file = yamlResourcePath(dir, parsed);
    await writeYamlDocumentFile(file, parsed);
    return { path: file };
  },
};
