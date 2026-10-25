import { PersonnelPhotoSpec } from "../../shared/io/index.js";
import type { storePersonnelPhoto } from "./store.js";

type PhotoFile = Awaited<ReturnType<typeof storePersonnelPhoto>>;
export async function preparePersonnelPhoto(
  personnelId: string,
  filename: string,
  adapters: {
    findPersonnel(id: string): Promise<boolean>;
    sourceIdFor(id: string): Promise<string>;
    store(filename: string): Promise<PhotoFile>;
  },
  sourceUrl?: string,
) {
  if (!(await adapters.findPersonnel(personnelId)))
    throw new Error(`Personnel not found: ${personnelId}`);
  const sourcePerson = await adapters.sourceIdFor(personnelId);
  const photo = await adapters.store(filename);
  return {
    kind: "PersonnelPhoto",
    record: PersonnelPhotoSpec.parse({
      id: sourcePerson,
      personnel_id: sourcePerson,
      ...photo,
      ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
    }),
  };
}
