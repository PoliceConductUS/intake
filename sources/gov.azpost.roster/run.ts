import type {
  SourceRun,
  EmittedRecords,
} from "../../src/cli/run/source-run.js";

/**
 * AZ POST officer roster: reads AGENCY, POST ID, LAST, FIRST, MIDDLE,
 * APPOINTED ON, TERMINATED ON, TERM DESC, CERTIFICATION, CERT TYPE columns
 * and maps only POST ID, FIRST, LAST, MIDDLE to a Personnel record keyed by
 * POST ID. Rows with a blank POST ID are skipped (no stable id to key on).
 * An officer can appear in multiple agency rows; later rows win on dedup.
 * Deterministic: no network/clock/randomness.
 */
export const run: SourceRun = async ({ paths, readXlsx }) => {
  const records: EmittedRecords = {};
  for (const path of paths) {
    for (const row of await readXlsx(path)) {
      const postId = (row["POST ID"] ?? "").trim();
      if (!postId) continue; // filter: no stable id
      const middle = (row["MIDDLE"] ?? "").trim();
      records[postId] = {
        spec: {
          id: postId,
          first_name: (row["FIRST"] ?? "").trim(),
          last_name: (row["LAST"] ?? "").trim(),
          middle_name: middle === "" ? null : middle,
        },
      };
    }
  }
  return { artifacts: [{ kind: "Personnel", records }] };
};
