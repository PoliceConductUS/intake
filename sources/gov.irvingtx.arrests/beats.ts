import { z } from "zod";

const position = z.tuple([z.number().finite(), z.number().finite()]);
const polygon = z.array(z.array(position).min(4)).min(1);
export const BeatBoundariesSchema = z
  .array(
    z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        geometry: z.discriminatedUnion("type", [
          z
            .object({ type: z.literal("Polygon"), coordinates: polygon })
            .strict(),
          z
            .object({
              type: z.literal("MultiPolygon"),
              coordinates: z.array(polygon).min(1),
            })
            .strict(),
        ]),
      })
      .strict(),
  )
  .superRefine((beats, ctx) => {
    const codes = new Set<string>();
    for (const beat of beats) {
      if (codes.has(beat.code))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate patrol beat ${beat.code}`,
        });
      codes.add(beat.code);
    }
  });

export function patrolBeatBoundaries(input: unknown) {
  const collection = z
    .object({
      features: z.array(
        z.object({
          properties: z.object({
            Code: z.string(),
            Name: z.string(),
            BattalionC: z.string(),
            IsActive: z.number(),
          }),
          geometry: z.unknown(),
        }),
      ),
    })
    .parse(input);
  return BeatBoundariesSchema.parse(
    collection.features
      .filter(
        ({ properties: p }) => p.BattalionC === "PD1" || p.BattalionC === "PD2",
      )
      .map(({ properties: p, geometry }) => ({
        code: p.Code,
        name: p.Name,
        geometry,
      })),
  );
}
