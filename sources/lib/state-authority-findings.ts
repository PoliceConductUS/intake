import type { EmittedRecords } from "../../src/cli/transform/source-transform.js";
import type { Finding } from "../../src/shared/data-annotations.js";

function stateCode(state: string): string {
  if (!/^[A-Za-z]{2}$/.test(state)) {
    throw new Error(`State is not a two-letter code: ${JSON.stringify(state)}`);
  }
  return state.toLowerCase();
}

export function stateAuthorityRecords(
  states: Iterable<string>,
  findingsByState: ReadonlyMap<string, Finding[]>,
): EmittedRecords {
  const defects = new Map<string, Finding[]>();
  for (const state of states) defects.set(stateCode(state), []);
  for (const [state, findings] of findingsByState) {
    const processed = defects.get(stateCode(state));
    if (processed === undefined) {
      throw new Error(
        `Findings for a state that was not processed: ${stateCode(state)}`,
      );
    }
    processed.push(...findings);
  }
  const records: EmittedRecords = {};
  for (const [state, findings] of defects) {
    records[state] = {
      metadata: {
        action: "PATCH",
        selector: { location_path: { path: `/${state}/` } },
        defects: findings,
      },
      spec: {},
    };
  }
  return records;
}
