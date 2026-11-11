import { z } from "zod";

const sourceContribution = {
  source_namespace: z.string().trim().min(1),
  source_record_id: z.string().trim().min(1),
};
const finding = {
  field: z.string().trim().min(1),
  value: z.json(),
  message: z.string().trim().min(1),
  evidence: z.array(z.record(z.string(), z.json())).optional(),
  ...sourceContribution,
};
export const CorrectionAnnotation = z.strictObject({
  ...finding,
  type: z.literal("correction"),
  replacement_value: z.json(),
});
export const DataAnnotation = z.discriminatedUnion("type", [
  z.strictObject({ ...finding, type: z.literal("warning") }),
  z.strictObject({ ...finding, type: z.literal("error") }),
  CorrectionAnnotation,
]);
export type DataAnnotation = z.infer<typeof DataAnnotation>;
export const CorrectionReplacement = z
  .strictObject({
    ...sourceContribution,
    corrections: z.array(CorrectionAnnotation),
  })
  .superRefine((replacement, context) => {
    replacement.corrections.forEach((entry, index) => {
      if (
        entry.source_namespace !== replacement.source_namespace ||
        entry.source_record_id !== replacement.source_record_id
      ) {
        context.addIssue({
          code: "custom",
          path: ["corrections", index],
          message:
            "Correction must belong to the replaced source contribution.",
        });
      }
    });
  });
export type CorrectionReplacement = z.infer<typeof CorrectionReplacement>;

export const SourceFieldEvidence = z.strictObject({
  value: z.json(),
  effective_value: z.json(),
  source_namespace: z.string().trim().min(1),
  source_record_id: z.string().trim().min(1),
});
export const SourceValues = z.record(z.string(), SourceFieldEvidence);
export type SourceValues = z.infer<typeof SourceValues>;

export const SourceContribution = CorrectionReplacement.safeExtend({
  values: SourceValues,
}).superRefine((contribution, context) => {
  for (const [field, evidence] of Object.entries(contribution.values)) {
    if (
      evidence.source_namespace !== contribution.source_namespace ||
      evidence.source_record_id !== contribution.source_record_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["values", field],
        message: "Field evidence must belong to the source contribution.",
      });
    }
  }
});
export type SourceContribution = z.infer<typeof SourceContribution>;

/** Explicit curation decisions grouped by source so reruns replace only their own evidence. */
export const SourceExclusions = z.record(
  z.string().trim().min(1),
  z.array(
    z.strictObject({
      kind: z.string().trim().min(1),
      key: z.string().trim().min(1),
      name: z.string().optional(),
      reason: z.string().trim().min(1),
    }),
  ),
);
export function replaceSourceExclusions(current: unknown, incoming: unknown) {
  return {
    ...SourceExclusions.parse(current),
    ...SourceExclusions.parse(incoming),
  };
}
