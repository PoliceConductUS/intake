import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { PersonnelCreate } from "../../src/cli/import/artifacts/io/generated-mutations/PersonnelCreate.js";
import { executeDatabaseMutations } from "../../src/cli/replay/database-mutations/execute.js";

for (const namespace of ["gov.tx.tcole", "gov.or.dpsst", "example.future"]) {
  for (const storage of ["inline", "reference"] as const) {
    test(`${namespace} replay rejects persisted invalid ${storage} personnel before SQL`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "personnel-replay-"));
      try {
        const metadata = { name: "person", namespace };
        const spec = { id: "person", first_name: "ValidName", slug: "person" };
        const person = await PersonnelCreate.write(
          root,
          PersonnelCreate.new({ metadata, spec }),
        );
        const mutations = await DatabaseMutations.write(
          root,
          DatabaseMutations.new({
            metadata,
            spec: {
              mutations:
                storage === "inline"
                  ? [{ kind: "PersonnelCreate", name: "person", spec }]
                  : [
                      {
                        ref: {
                          path: path.basename(person.path),
                          kind: "PersonnelCreate",
                        },
                      },
                    ],
            },
          }),
        );
        // Deliberately corrupt a canonical-IO fixture to represent an old artifact
        // written before validation. No production writer may bypass canonical IO.
        const target = storage === "inline" ? mutations.path : person.path;
        const invalid = (await readFile(target, "utf8")).replace(
          "ValidName",
          '"9"',
        );
        await writeFile(target, invalid);
        const query = vi.fn(async () => {
          throw new Error("Unexpected database write");
        });
        await expect(
          executeDatabaseMutations(
            { connect: async () => {}, end: async () => {}, query },
            mutations.path,
          ),
        ).rejects.toThrow(/malformed/);
        expect(query).not.toHaveBeenCalled();
        expect(await readFile(target, "utf8")).toBe(invalid);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
