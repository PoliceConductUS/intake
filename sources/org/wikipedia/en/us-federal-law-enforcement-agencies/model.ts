import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SOURCE_ID = "org/wikipedia/en/us-federal-law-enforcement-agencies";

export const ORGS_FILE = "federal-agencies.yaml";
export const CANDIDATES_FILE = "federal-agencies.candidates.yaml";
export const OFFICES_FILE = "offices.yaml";

const filled = z
  .string()
  .refine((value) => value.trim() !== "", { error: "is blank" });

const OrgSchema = z.strictObject({ slug: filled, name: filled });

const OfficeSchema = z.strictObject({
  federal_agency: filled,
  slug: filled,
  name: filled,
  state: filled,
  city: filled,
  address: filled,
  zip_code: filled,
});

export const OrgsFileSchema = z.strictObject({ agencies: z.array(OrgSchema) });
export const OfficesFileSchema = z.strictObject({
  offices: z.array(OfficeSchema),
});

export type Org = z.infer<typeof OrgSchema>;
export type Office = z.infer<typeof OfficeSchema>;

export async function readCuratedFile<T>(
  stateDir: string,
  file: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  let contents: string;
  try {
    contents = await readFile(path.join(stateDir, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = schema.safeParse(parseYaml(contents));
  if (!parsed.success)
    throw new Error(
      `${SOURCE_ID}: ${file} is not valid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  return parsed.data;
}
