import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const grams = z
  .number()
  .nullable()
  .describe('Grams; null when unknown (not 0)');

/** The fields of a food in responses (no schema id: see FoodSchema and FoodDto) */
const FoodFields = z.object({
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
  visibility: z
    .enum(['public', 'private'])
    .describe('private = only its owner sees it'),
  mine: z.boolean().describe('Created by the current user'),
  basedOnId: z
    .uuid()
    .nullable()
    .describe('The food this one was copied from (a personal correction)'),
  retired: z
    .boolean()
    .describe(
      'No longer offered (gone from the source, or retired by its owner); still readable by id',
    ),
});

/**
 * A food nested in other responses (search results, barcode lookups): one reusable
 * "Food" component in the OpenAPI document
 */
export const FoodSchema = FoodFields.meta({ id: 'Food' });

export type Food = z.infer<typeof FoodSchema>;

/**
 * A food as a whole response (GET/POST/PUT). Built from the fields without the schema
 * id: as a top-level DTO, the id'd schema converts slightly differently and the OpenAPI
 * generator rejects two "Food" schemas that aren't identical.
 */
export class FoodDto extends createZodDto(FoodFields) {}

const optionalGrams = z
  .number()
  .min(0)
  .max(100)
  .nullable()
  .default(null)
  .describe('Grams per 100 g or 100 ml; null or omitted when unknown');

/** A food as a user enters it (create, or replace in full) */
export const FoodInputSchema = z
  .object({
    names: z
      .record(
        z.string().regex(/^[a-z]{2}$/, 'Use a two-letter language code'),
        z.string().trim().min(1).max(200),
      )
      .refine(
        (names) => Object.keys(names).length > 0,
        'Give at least one name',
      )
      .describe(
        'Names by language, e.g. { "pl": "Mój serek", "ru": "Мой сырок" }',
      ),
    brand: z.string().trim().min(1).max(200).nullable().default(null),
    barcode: z
      .string()
      .regex(/^\d{8,14}$/, 'A barcode has 8 to 14 digits')
      .nullable()
      .default(null)
      .describe('As printed; stored as GTIN-14'),
    basis: z.enum(['g', 'ml']).default('g'),
    per100: z.object({
      kcal: z.number().min(0).max(1000),
      protein: optionalGrams,
      fat: optionalGrams,
      carbs: optionalGrams,
      sugars: optionalGrams,
      fiber: optionalGrams,
      saturatedFat: optionalGrams,
      salt: optionalGrams,
    }),
    servings: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          amount: z.number().positive().max(10_000),
        }),
      )
      .max(20)
      .default([]),
    visibility: z
      .enum(['public', 'private'])
      .default('private')
      .describe('public (for everyone) needs the contributor role'),
  })
  // The same plausibility rule as the import: macros can't outweigh 100 g (+5 g rounding)
  .refine(
    ({ basis, per100: { protein, fat, carbs } }) =>
      basis !== 'g' || (protein ?? 0) + (fat ?? 0) + (carbs ?? 0) <= 105,
    {
      path: ['per100'],
      message: 'Protein, fat and carbs add up to more than 100 g',
    },
  );

export type FoodInput = z.infer<typeof FoodInputSchema>;

export class CreateFoodDto extends createZodDto(
  FoodInputSchema.extend({
    basedOnId: z
      .uuid()
      .nullable()
      .default(null)
      .describe(
        'Copy of this food: "editing" a food you can\'t change creates your own version',
      ),
  }),
) {}

export class ReplaceFoodDto extends createZodDto(FoodInputSchema) {}

export class FoodIdParamsDto extends createZodDto(z.object({ id: z.uuid() })) {}

export const BarcodeLookupSchema = z
  .object({
    // No .describe() here: it would create a second, slightly different "Food" schema
    // under the same id, which the OpenAPI generator rejects
    food: FoodSchema,
    alternatives: z
      .array(FoodSchema)
      .describe('Other foods with this barcode, best first'),
  })
  // Named after its DTO class in the docs; only nested reused schemas get a meta id
  .describe(
    'A barcode lookup result: the best match (food), plus alternatives',
  );

export class BarcodeLookupDto extends createZodDto(BarcodeLookupSchema) {}

export class BarcodeParamsDto extends createZodDto(
  z.object({
    code: z
      .string()
      .regex(/^\d{8,14}$/, 'A barcode has 8 to 14 digits')
      .describe('EAN-8, UPC-A, EAN-13 or GTIN-14, as printed'),
  }),
) {}

/** Deep offsets get slower; nobody pages that far through food search */
const MAX_OFFSET = 1000;

export class SearchQueryDto extends createZodDto(
  z.object({
    q: z
      .string()
      .trim()
      .min(2, 'Type at least 2 characters')
      .max(100)
      .describe(
        'Words or the start of words, in any language; accents optional',
      ),
    // Query parameters arrive as strings
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  }),
) {}

export const SearchResultSchema = z
  .object({
    items: z
      .array(FoodSchema)
      .describe(
        'Foods sold in Poland first, then by match quality and popularity',
      ),
    nextOffset: z
      .number()
      .int()
      .nullable()
      .describe(
        'Pass as offset for the next page; null on the last page. There is no total count: counting every match would be as slow as the slowest search.',
      ),
  })
  .describe('A page of search results');

export class SearchResultDto extends createZodDto(SearchResultSchema) {}

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
