import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import { transform } from "../../../../../sources/org/washingtonpost/fatal-force/transform.js";
import { buildArtifactsEnvelope } from "../../../../../src/cli/transform/source-transform.js";
import {
  COMMIT,
  FILES,
  fileUrl,
} from "../../../../../sources/org/washingtonpost/fatal-force/evidence.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});
const header =
  "id,date,threat_type,flee_status,armed_with,city,county,state,latitude,longitude,location_precision,name,age,gender,race,race_source,was_mental_illness_related,body_camera,agency_ids\n";
async function run(
  row = "1,2020-02-29,undetermined,not,unarmed,Test City,Test County,ZZ,1,2,block,Synthetic Person,23,male,,,False,True,7\n",
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fatal-force-transform-"));
  dirs.push(dir);
  const contents = [
    header + row,
    "id,name,type,state,oricodes,total_shootings\n7,Synthetic Agency,local_police,ZZ,TEST001;TEST002,1\n",
  ];
  const evidence: Record<string, unknown> = {};
  for (let i = 0; i < FILES.length; i++) {
    const file = FILES[i]!;
    const bytes = Buffer.from(contents[i]!);
    await writeFile(path.join(dir, file), bytes);
    evidence[file] = {
      sourceUrl: fileUrl(COMMIT, file),
      commit: COMMIT,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      retrievedAt: "2026-11-14T00:00:00.000Z",
    };
  }
  await writeFile(path.join(dir, "provenance.json"), JSON.stringify(evidence));
  const deps = {
    paths: FILES.map((f) => path.join(dir, f)),
    state: dir,
    emit: async () => {},
    logger: { info: vi.fn() },
    readXlsx: async () => [],
  };
  return { deps, manifest: await transform(deps) };
}
test("preserves source claims and unresolved agency identity in deterministic canonical envelopes", async () => {
  const { deps, manifest } = await run();
  expect(await transform(deps)).toEqual(manifest);
  const envelope = buildArtifactsEnvelope(
    "org/washingtonpost/fatal-force",
    "synthetic",
    manifest,
  );
  expect(envelope.spec.artifacts).toHaveLength(2);
  expect(manifest.artifacts.map((a) => a.kind)).toEqual([
    "FatalShootings",
    "FatalShootingAgencies",
  ]);
  expect(manifest.artifacts[0]!.records["1"]!.spec).toMatchObject({
    name: "Synthetic Person",
    date: "2020-02-29",
    race: null,
    body_camera: true,
    was_mental_illness_related: false,
    reported_agency_ids: "7",
    source_record_id: "1",
    evidence_status: "source_reported",
    redistribution_class: "noncommercial_sharealike",
  });
  expect(manifest.artifacts[1]!.records["7"]!.spec).toMatchObject({
    agency_id: null,
    oricodes: "TEST001;TEST002",
  });
});
test.each([
  [
    "date",
    "1,2020-02-30,undetermined,not,unarmed,,,,,,,Synthetic Person,,,,,False,True,7\n",
  ],
  [
    "boolean",
    "1,2020-02-29,undetermined,not,unarmed,,,,,,,Synthetic Person,,,,,FALSE,True,7\n",
  ],
  [
    "agency",
    "1,2020-02-29,undetermined,not,unarmed,,,,,,,Synthetic Person,,,,,False,True,8\n",
  ],
])(
  "rejects invalid %s evidence without dropping a row",
  async (_label, row) => {
    await expect(run(row)).rejects.toThrow();
  },
);

test("preserves an incident with no reported agency instead of dropping it", async () => {
  const { deps, manifest } = await run(
    "1,2020-02-29,undetermined,not,unarmed,,,,,,,Synthetic Person,,,,,False,True,\n",
  );
  expect(manifest.artifacts[0]!.records["1"]!.spec).toMatchObject({
    reported_agency_ids: null,
  });
  expect(deps.logger.info).toHaveBeenCalledWith(
    expect.stringContaining("reported total_shootings=1, incident links=0"),
  );
});
