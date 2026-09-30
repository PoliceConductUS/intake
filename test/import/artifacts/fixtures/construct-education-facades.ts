import { DataContext } from "../../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../../src/shared/io/import-types.js";

const context = new DataContext({
  resolvedPropertyStore: {
    read: async () => {
      throw new Error("Facade construction must not read resolved properties.");
    },
    write: async () => {
      throw new Error(
        "Facade construction must not write resolved properties.",
      );
    },
  },
});
const count = 100_000;
for (let index = 0; index < count; index++) {
  context.facadeFromSource("PersonnelEducation", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "memory-test",
    name: `course-${index}`,
    spec: {
      personnel_id: "person",
      name: `Training ${index}`,
      completion_date: "2026-01-01",
      credits: 1,
      sponsor_name: "Sponsor",
      sponsor_instructor: null,
    },
  });
}

global.gc!();
console.log(
  JSON.stringify({
    count,
    heapUsed: process.memoryUsage().heapUsed,
    // Keep the context and every registered facade reachable through the GC.
    lastName: context
      .facadeFromSource("PersonnelEducation", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "memory-test",
        name: "course-99999",
      })
      .raw("name"),
  }),
);
