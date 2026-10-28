import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const grams = z
  .number()
  .nullable()
  .describe('Grams; null when unknown (not 0)');

export const FoodSchema = z
  .object({
    id: z.uuid(),
    source: z
      .enum(['off', 'usda', 'user'])
      .describe('off = Open Food Facts, user = entered by a user'),
    sourceRef: z
      .string()
      .nullable()
      .describe('The id at the source, e.g. the Open Food Facts code'),
    barcode: z.string().nullable().describe('GTIN-14: 14 digits, zero-padded'),
    name: z
      .string()
      .describe(
        'Display name: the first Accept-Language with a name, else Polish, English or any',
      ),
    names: z
      .record(z.string(), z.string())
      .describe('All names by language code, e.g. { "pl": "Twaróg" }'),
    brand: z.string().nullable(),
    basis: z
      .enum(['g', 'ml'])
      .describe('Nutrient values are per 100 g or per 100 ml'),
    per100: z.object({
      kcal: z.number(),
      protein: grams,
      fat: grams,
      carbs: grams,
      sugars: grams,
      fiber: grams,
      saturatedFat: grams,
      salt: grams,
    }),
    otherNutrients: z
      .record(z.string(), z.object({ value: z.number(), unit: z.string() }))
      .describe('Vitamins, minerals etc. per 100 g or 100 ml, for display'),
    servings: z.array(
      z.object({
        label: z.string(),
        amount: z.number().describe('In the basis unit (g or ml)'),
      }),
    ),
    countries: z
      .array(z.string())
      .describe('Where it is sold, e.g. ["poland", "ireland"]'),
  })
  .meta({ id: 'Food' });

export type Food = z.infer<typeof FoodSchema>;

export const BarcodeLookupSchema = z
  .object({
    food: FoodSchema.describe('The best match'),
    alternatives: z
      .array(FoodSchema)
      .describe('Other foods with this barcode, best first'),
  })
  // Named after its DTO class in the docs; only nested reused schemas get a meta id
  .describe('A barcode lookup result');

export class BarcodeLookupDto extends createZodDto(BarcodeLookupSchema) {}

export class BarcodeParamsDto extends createZodDto(
  z.object({
    code: z
      .string()
      .regex(/^\d{8,14}$/, 'A barcode has 8 to 14 digits')
      .describe('EAN-8, UPC-A, EAN-13 or GTIN-14, as printed'),
  }),
) {}

export const ProblemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Validation errors, one per invalid field'),
  })
  .describe('RFC 9457 problem details');

export class ProblemDetailsDto extends createZodDto(ProblemDetailsSchema) {}
