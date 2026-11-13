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

export class CreateEntryDto extends createZodDto(
  ManualEntryFields.describe('Values are stored to one decimal'),
) {}

/** PUT replaces an entry in full; a new date moves it to another day */
const EntryChangeFields = ManualEntryFields.extend({
  date: CalendarDateSchema,
});

export type EntryChange = z.infer<typeof EntryChangeFields>;

export class ReplaceEntryDto extends createZodDto(EntryChangeFields) {}

const grams = z
  .number()
  .nullable()
  .describe('Grams; null when unknown (not 0)');

const EntrySchema = z
  .object({
    id: z.uuid(),
    date: CalendarDateSchema,
    meal: MealSchema,
    name: z.string().nullable(),
    kcal: z.number(),
    proteinG: grams,
    fatG: grams,
    carbsG: grams,
    fiberG: grams,
  })
  .describe('Something the user ate, with values for the whole entry');

export type Entry = z.infer<typeof EntrySchema>;

export class EntryDto extends createZodDto(EntrySchema) {}

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
