import { DataContext } from "../../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../../src/shared/io/import-types.js";
const c = new DataContext({
  commandName: "profile",
  client: {
    connect: async () => {},
    end: async () => {},
    query: async (sql, params) => ({
      rows: sql.includes("personnel_education") ? [{ id: params?.[0] }] : [],
    }),
  },
  validationDate: new Date("2026-10-29"),
});
const count = Number(process.argv[2] ?? 100000);
for (let i = 0; i < count; i++) {
  const name = `course-${i}`;
  const spec = {
    name: `Training ${i}`,
    completion_date: "2026-01-01",
    credits: 1,
    sponsor_name: "Sponsor",
    sponsor_instructor: null,
  };
  const values = Object.fromEntries(
    Object.entries(spec).map(([field, value]) => [
      field,
      {
        value,
        effective_value: value,
        source_namespace: "profile",
        source_record_id: name,
      },
    ]),
  );
  c.facadeFromSource("PersonnelEducation", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "profile",
    name,
    action: "PATCH",
    selector: { id: name },
    current: {
      id: name,
      personnel_id: "person",
      ...spec,
      data_source_values: values,
    },
    spec,
  });
}
global.gc?.();
console.error("constructed", process.memoryUsage().heapUsed);
const result = await c.toDatabaseMutationItems();
global.gc?.();
console.log(
  JSON.stringify({
    count: result.length,
    heapUsed: process.memoryUsage().heapUsed,
  }),
);
if (result.length) process.exitCode = 1;
