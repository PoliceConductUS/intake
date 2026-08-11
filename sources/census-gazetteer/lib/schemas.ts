import { z } from "zod";

/**
 * Zod schemas for U.S. Census Gazetteer pipe-delimited record types, ported
 * verbatim from `intake.census-gazetteer/src/schemas.js`. Only the gazetteer
 * record shapes consumed by `parseGazetteerFile` are ported here — the
 * Command/envelope schemas from the original file are standalone-producer
 * plumbing and are intentionally left behind.
 */

const numericStringSchema = z.string().regex(/^\d+$/);
const signedDecimalStringSchema = z.string().regex(/^[+-]?\d+(\.\d+)?$/);

const gazetteerRecordBaseSchema = z
  .object({
    USPS: z.string().regex(/^[A-Z]{2}$/),
    GEOID: numericStringSchema,
    ANSICODE: z.string().min(1).optional(),
    NAME: z.string().min(1),
    ALAND: numericStringSchema,
    AWATER: numericStringSchema,
    INTPTLAT: signedDecimalStringSchema,
    INTPTLONG: signedDecimalStringSchema,
  })
  .strict();

export const gazetteerStateRecordSchema = gazetteerRecordBaseSchema.extend({
  GEOID: z.string().regex(/^\d{2}$/),
});

export const gazetteerAdministrativeAreaRecordSchema =
  gazetteerRecordBaseSchema.extend({
    GEOID: z.string().regex(/^\d{5}$/),
  });

export const gazetteerPlaceRecordSchema = gazetteerRecordBaseSchema.extend({
  GEOID: z.string().regex(/^\d{7}$/),
});

export type GazetteerStateRecord = z.infer<typeof gazetteerStateRecordSchema>;
export type GazetteerAdministrativeAreaRecord = z.infer<
  typeof gazetteerAdministrativeAreaRecordSchema
>;
export type GazetteerPlaceRecord = z.infer<typeof gazetteerPlaceRecordSchema>;

/**
 * Ported verbatim from `intake.census-gazetteer/src/schemas.js`
 * (`deterministicTotalAreaOverlapRecordSchema`) — the shape of a single
 * place↔administrative-area overlap record produced by
 * `buildHierarchyFromTiger` in `tiger-hierarchy.ts`.
 */
export const deterministicTotalAreaOverlapRecordSchema = z
  .object({
    stateGeoid: z.string().regex(/^\d{2}$/),
    administrativeAreaGeoid: z.string().regex(/^\d{5}$/),
    placeGeoid: z.string().regex(/^\d{7}$/),
    overlapTotalArea: z.number().nonnegative(),
    sourceKey: z.string().min(1),
    placeName: z.string().min(1).optional(),
    placeLabel: z.string().min(1).optional(),
  })
  .strict();

export type DeterministicTotalAreaOverlapRecord = z.infer<
  typeof deterministicTotalAreaOverlapRecordSchema
>;
