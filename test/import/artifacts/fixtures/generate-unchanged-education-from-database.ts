import { DataContext } from "../../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../../src/shared/io/import-types.js";

function spec(i: number) {
  return {
    name: `Training ${i}`,
    completion_date: "2026-01-01",
    credits: 1,
    sponsor_name: "Sponsor",
    sponsor_instructor: null,
  };
}

function sourceValues(name: string, i: number) {
  return Object.fromEntries(
    Object.entries(spec(i)).map(([field, value]) => [
      field,
      {
        value,
        effective_value: value,
        source_namespace: "profile",
        source_record_id: name,
      },
    ]),
  );
}

// The stored row the database returns, built fresh per read the way the
// driver parses a row (its JSON column included).
function storedRow(name: string) {
  const i = Number(name.slice("course-".length));
  return {
    id: name,
    personnel_id: "person",
    ...spec(i),
    data_source_values: JSON.parse(JSON.stringify(sourceValues(name, i))),
  };
}

const c = new DataContext({
  commandName: "profile",
  client: {
    connect: async () => {},
    end: async () => {},
    query: async (sql, params) => {
      if (!sql.includes("personnel_education")) return { rows: [] };
      const ids = params?.[0];
      return {
        rows: (Array.isArray(ids) ? ids : [ids]).map((id) =>
          storedRow(String(id)),
        ),
      };
    },
  },
  validationDate: new Date("2026-10-29"),
});
const count = Number(process.argv[2] ?? 100000);
for (let i = 0; i < count; i++) {
  const name = `course-${i}`;
  c.facadeFromSource("PersonnelEducation", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "profile",
    name,
    action: "PATCH",
    selector: { id: name },
    spec: spec(i),
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
