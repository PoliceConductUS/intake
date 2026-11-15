import { z } from "zod";
export const manifestSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    prefixes: z.array(z.string().min(1)).min(1),
    searchFiles: z.array(z.string().min(1)),
    officers: z.array(
      z
        .object({
          id: z.string().min(1),
          employmentFiles: z.array(z.string().min(1)),
          certificateFiles: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    agencies: z.array(
      z.object({ id: z.string().min(1), file: z.string().min(1) }).strict(),
    ),
  })
  .strict();
export type AcquisitionManifest = z.infer<typeof manifestSchema>;
