import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CalendarDateSchema } from '../calendar-date';
import { MACROS } from './day-summary';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

const MealSchema = z.enum(MEALS);

const optionalGrams = z
  .number()
  .min(0)
  .max(1000)
  .nullable()
  .default(null)
  .describe('Grams for the whole entry; null or omitted when unknown');

/** A manual entry as the user types it: only kcal is required */
const ManualEntryFields = z.object({
  kind: z.literal('manual'),
  meal: MealSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .default(null)
    .describe('e.g. "Lunch at work"; optional'),
  kcal: z.number().min(0).max(10_000),
  proteinG: optionalGrams,
  fatG: optionalGrams,
  carbsG: optionalGrams,
  fiberG: optionalGrams,
});

export type ManualEntry = z.infer<typeof ManualEntryFields>;

/** A food from the catalog and how much of it: the values come from the catalog */
const FoodEntryFields = z.object({
  kind: z.literal('food'),
  meal: MealSchema,
  foodId: z.uuid().describe('A food from the catalog'),
  amount: z
    .number()
    .positive()
    .max(5000)
    .describe("In the food's basis unit: grams or millilitres"),
});

export type FoodEntryInput = z.infer<typeof FoodEntryFields>;

const NewEntrySchema = z
  .discriminatedUnion('kind', [ManualEntryFields, FoodEntryFields])
  .describe('Values are stored to one decimal');

export type NewEntry = z.infer<typeof NewEntrySchema>;

/**
 * A class can't extend a union, so a union DTO is a value and a type of the same name.
 * TypeScript emits the value as the parameter's runtime type, which is what the zod
 * validation pipe and the OpenAPI document read. The class name becomes the schema's.
 */
function unionDto(name: string, schema: z.ZodType) {
  const dto = createZodDto(schema);
  Object.defineProperty(dto, 'name', { value: name });
  return dto;
}

export const CreateEntryDto = unionDto('CreateEntryDto', NewEntrySchema);
export type CreateEntryDto = NewEntry;

/** PUT replaces an entry in full; a new date moves it to another day */
const EntryChangeSchema = z.discriminatedUnion('kind', [
  ManualEntryFields.extend({ date: CalendarDateSchema }),
  FoodEntryFields.extend({ date: CalendarDateSchema }),
]);

export type EntryChange = z.infer<typeof EntryChangeSchema>;

export const ReplaceEntryDto = unionDto('ReplaceEntryDto', EntryChangeSchema);
export type ReplaceEntryDto = EntryChange;

const grams = z
  .number()
  .nullable()
  .describe('Grams; null when unknown (not 0)');

const FoodSnapshotSchema = z
  .object({
    id: z.uuid(),
    amount: z.number().describe('In the basis unit'),
    basis: z.enum(['g', 'ml']),
    brand: z.string().nullable(),
    per100: z.object({
      kcal: z.number(),
      proteinG: grams,
      fatG: grams,
      carbsG: grams,
      fiberG: grams,
    }),
  })
  .describe(
    'The food as it was when logged; later catalog changes leave it alone',
  );

const EntrySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['manual', 'food']),
    date: CalendarDateSchema,
    meal: MealSchema,
    name: z.string().nullable().describe("For a food entry, the food's name"),
    kcal: z.number(),
    proteinG: grams,
    fatG: grams,
    carbsG: grams,
    fiberG: grams,
    food: FoodSnapshotSchema.nullable().describe('Null for a manual entry'),
  })
  .describe('Something the user ate, with values for the whole entry');

export type Entry = z.infer<typeof EntrySchema>;

export class EntryDto extends createZodDto(EntrySchema) {}

/** A batch limit: one request can't insert an unbounded number of rows */
export const MAX_COPIES = 50;

const CopyEntriesSchema = z.object({
  entryIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_COPIES)
    .refine((ids) => new Set(ids).size === ids.length, 'Each entry only once')
    .describe(
      'Entries of your diary, from any day, each once; copied in this order',
    ),
  meal: MealSchema.optional().describe(
    'Every copy goes into this meal; when omitted, each keeps its own',
  ),
});

export type CopyEntries = z.infer<typeof CopyEntriesSchema>;

export class CopyEntriesDto extends createZodDto(CopyEntriesSchema) {}

export class CopiedEntriesDto extends createZodDto(
  z.object({
    entries: z.array(EntrySchema).describe('The copies, in the order asked'),
  }),
) {}

const NutrientsSchema = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  fatG: z.number(),
  carbsG: z.number(),
  fiberG: z.number(),
});

const MealViewSchema = z.object({
  entries: z.array(EntrySchema).describe('In the order they were logged'),
  totals: NutrientsSchema,
});

const DaySchema = z
  .object({
    date: CalendarDateSchema,
    meals: z.object({
      breakfast: MealViewSchema,
      lunch: MealViewSchema,
      dinner: MealViewSchema,
      snack: MealViewSchema,
    }),
    totals: NutrientsSchema.describe('Unknown macros count as nothing'),
    targets: NutrientsSchema.nullable().describe(
      'From the goal in effect on this day; null without a goal',
    ),
    remaining: NutrientsSchema.nullable().describe(
      'Targets minus totals, negative when over; null without a goal',
    ),
    incomplete: z
      .array(z.enum(MACROS))
      .describe(
        'Macros that some entry does not know: their totals are a lower bound',
      ),
  })
  .describe("A day's entries by meal, against the goal's targets");

export type Day = z.infer<typeof DaySchema>;

export class DayDto extends createZodDto(DaySchema) {}

export class DayParamsDto extends createZodDto(
  z.object({ date: CalendarDateSchema }),
) {}

export class EntryIdParamsDto extends createZodDto(
  z.object({ id: z.uuid() }),
) {}
