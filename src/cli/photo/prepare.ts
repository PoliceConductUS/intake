import { PersonnelPhotoSpec } from "../../shared/io/index.js";
import type { readPersonnelPhoto } from "./store.js";

type PhotoRead = Awaited<ReturnType<typeof readPersonnelPhoto>>;
export async function preparePersonnelPhoto(
  personnelId: string,
  filename: string,
  adapters: {
    findPersonnel(id: string): Promise<boolean>;
    sourceIdFor(id: string): Promise<string>;
    read(filename: string): Promise<PhotoRead>;
    write(workspacePath: string, bytes: Buffer): Promise<void>;
  },
  sourceUrl?: string,
) {
  if (!(await adapters.findPersonnel(personnelId)))
    throw new Error(`Personnel not found: ${personnelId}`);
  const sourcePerson = await adapters.sourceIdFor(personnelId);
  const { photo, bytes } = await adapters.read(filename);
  const record = PersonnelPhotoSpec.parse({
    id: sourcePerson,
    personnel_id: sourcePerson,
    ...photo,
    ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
  });
  await adapters.write(record.workspace_path, bytes);
  return { kind: "PersonnelPhoto", record };
}
