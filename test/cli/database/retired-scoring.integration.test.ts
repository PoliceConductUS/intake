import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startIntakeDatabase } from "./intake-postgres.js";

test("retired scoring objects are absent and cleanup can be replayed", async () => {
  const db = await startIntakeDatabase();
  try {
    const assertRetired = async () => {
      expect(
        (
          await db.query(
            "select tgname from pg_trigger where tgrelid='public.agency_personnel'::regclass and tgname='agency_officer_change'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid::regprocedure::text = any($1::text[])",
            [
              [
                "calculate_agency_officer_stats(text)",
                "calculate_officer_trait_stats(text)",
                "calculate_overall_rating_stats(jsonb)",
                "calculate_rating_stats(jsonb)",
                "get_rating_category(numeric)",
                "get_rating_category(text)",
                "handle_agency_officer_change()",
                "handle_review_rating_change()",
                "prevent_trait_deletion()",
                "prevent_trait_modification()",
                "recalculate_all_officer_stats()",
                "update_agency_overall_rating(text)",
                "update_agency_stats(text)",
                "update_officer_overall_rating(text)",
                "update_overall_stats()",
              ],
            ],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select to_regprocedure('public.trigger_set_timestamp()') is not null as present",
          )
        ).rows,
      ).toEqual([{ present: true }]);
    };
    await assertRetired();
    await db.query(
      await readFile(
        new URL(
          "../../../supabase/migrations/20261028000000_drop_retired_scoring_functions.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await assertRetired();
  } finally {
    await db.stop();
  }
}, 120_000);
