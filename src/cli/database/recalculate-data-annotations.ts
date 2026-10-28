import { z } from "zod";
import { DataAnnotation, SourceValues } from "../../shared/data-annotations.js";
import { inspectDataAnnotations } from "../../shared/inspect-data-annotations.js";
import {
  TABLE_BY_KIND,
  PRIMARY_KEY_BY_KIND,
  RECORD_KINDS_IN_DEPENDENCY_ORDER,
} from "../../shared/io/generated/entity-specs.js";
import { rowsFromResult, type DatabaseClient } from "./index.js";

/** Publish one complete scan atomically, after the caller's mutation batch commits. */
export async function recalculateDataAnnotations(
  database: Pick<DatabaseClient, "query">,
  validationDate: Date = new Date(),
): Promise<void> {
  await database.query("begin isolation level repeatable read");
  try {
    for (const kind of RECORD_KINDS_IN_DEPENDENCY_ORDER) {
      const table = TABLE_BY_KIND[kind];
      const identity = PRIMARY_KEY_BY_KIND[kind];
      const eligible =
        kind === "LicensingAuthority"
          ? "data_source_values <> '{}'::jsonb or source_exclusions <> '{}'::jsonb or data_annotations <> '[]'::jsonb"
          : "data_source_values <> '{}'::jsonb";
      const records = rowsFromResult(
        await database.query(
          `select * from ${table} where ${eligible} order by ${identity} for update`,
        ),
      );
      for (const record of records) {
        const evidence = SourceValues.parse(record.data_source_values);
        const current = z.array(DataAnnotation).parse(record.data_annotations);
        const annotations = [
          ...current.filter((entry) => entry.type === "correction"),
          ...inspectDataAnnotations(kind, record, evidence, validationDate),
        ];
        await database.query(
          `update ${table} set data_annotations = $2::jsonb where ${identity} = $1 and data_annotations is distinct from $2::jsonb`,
          [record[identity], JSON.stringify(annotations)],
        );
      }
    }
    await database.query("commit");
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}
