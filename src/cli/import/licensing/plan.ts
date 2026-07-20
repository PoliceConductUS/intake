import { z } from "zod";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, "state must be a lowercase location slug");

const reportSchema = z.object({
  id: z.string().min(1),
  key: z.literal("licensing-summary"),
  title: z.string().min(1),
  summary: z.string().min(1).nullable(),
  sortOrder: z.number().int(),
  publishedAt: z.string().min(1).nullable(),
});

const organizationSchema = z.object({
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  url: z.string().url(),
});

const factSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  sourceKeys: z.array(z.string().min(1)).min(1),
});

const sourceSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url(),
  type: z.enum(["law", "methodology", "pdf", "web"]),
  sortOrder: z.number().int(),
});

const pendingFileSchema = z.object({
  state: slugSchema,
  status: z.literal("pending"),
  asOf: z.null(),
  report: reportSchema,
  organization: z.null(),
  facts: z.array(factSchema).max(0),
  note: z.null(),
  sources: z.array(sourceSchema).max(0),
});

const verifiedFileSchema = z
  .object({
    state: slugSchema,
    status: z.literal("verified"),
    asOf: z.string().min(1),
    report: reportSchema.extend({
      summary: z.string().min(1),
      publishedAt: z.string().min(1),
    }),
    organization: organizationSchema,
    facts: z.array(factSchema).min(1),
    note: z.string().min(1).nullable(),
    sources: z.array(sourceSchema).min(1),
  })
  .superRefine((file, context) => {
    const sourceKeys = new Set(file.sources.map((source) => source.key));
    for (const fact of file.facts) {
      for (const sourceKey of fact.sourceKeys) {
        if (!sourceKeys.has(sourceKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `fact "${fact.key}" references unknown sourceKey "${sourceKey}"`,
            path: ["facts"],
          });
        }
      }
    }
    const duplicateKeys = file.sources.length !== sourceKeys.size;
    if (duplicateKeys) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sources contain duplicate keys",
        path: ["sources"],
      });
    }
  });

export const licensingFileSchema = z.discriminatedUnion("status", [
  pendingFileSchema,
  verifiedFileSchema,
]);

export type LicensingFile = z.infer<typeof licensingFileSchema>;
export type VerifiedLicensingFile = Extract<
  LicensingFile,
  { status: "verified" }
>;

export type LicensingReportRow = {
  id: string;
  reportType: "licensing_summary";
  reportKey: "licensing-summary";
  title: string;
  summary: string;
  payload: {
    organization: VerifiedLicensingFile["organization"];
    facts: VerifiedLicensingFile["facts"];
    note: string | null;
  };
  sortOrder: number;
  status: "published";
  publishedAt: string;
};

export type LicensingSourceRow = {
  id: string;
  sourceKey: string;
  label: string;
  url: string;
  sourceType: string;
  sortOrder: number;
};

export type LicensingStatePlan = {
  state: string;
  report: LicensingReportRow;
  sources: LicensingSourceRow[];
};

export function parseLicensingFile(
  raw: string,
): { file: LicensingFile } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { error: `invalid JSON: ${(cause as Error).message}` };
  }

  const result = licensingFileSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { error: details };
  }

  return { file: result.data };
}

export function planStateImport(
  file: VerifiedLicensingFile,
): LicensingStatePlan {
  return {
    state: file.state,
    report: {
      id: file.report.id,
      reportType: "licensing_summary",
      reportKey: file.report.key,
      title: file.report.title,
      summary: file.report.summary,
      payload: {
        organization: file.organization,
        facts: file.facts,
        note: file.note,
      },
      sortOrder: file.report.sortOrder,
      status: "published",
      publishedAt: file.report.publishedAt,
    },
    sources: file.sources.map((source) => ({
      id: source.id,
      sourceKey: source.key,
      label: source.label,
      url: source.url,
      sourceType: source.type,
      sortOrder: source.sortOrder,
    })),
  };
}
