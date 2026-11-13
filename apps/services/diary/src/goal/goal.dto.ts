import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CalendarDateSchema } from '../calendar-date';

const grams = (max: number) => z.int().min(0).max(max);

/** A goal as the user enters it (PUT replaces it in full) */
export const GoalSettingsSchema = z.object({
  maintenanceKcal: z
    .int()
    .min(800)
    .max(8000)
    .describe('Calories a day that keep the weight stable'),
  adjustment: z
    .discriminatedUnion('unit', [
      z.object({ unit: z.literal('percent'), value: z.int().min(-50).max(50) }),
      z.object({
        unit: z.literal('kcal'),
        value: z.int().min(-3000).max(3000),
      }),
    ])
    .default({ unit: 'kcal', value: 0 })
    .describe(
      'From maintenance to the budget: negative for a deficit, positive for a surplus; none when omitted',
    ),
  proteinG: grams(500),
  fatG: grams(300),
  fiberG: grams(150),
});

export class GoalSettingsDto extends createZodDto(GoalSettingsSchema) {}

const GoalSchema = z
  .object({
    effectiveFrom: CalendarDateSchema.describe(
      "In effect from this date until the user's next goal starts",
    ),
    maintenanceKcal: z.int(),
    adjustment: z.object({
      unit: z.enum(['percent', 'kcal']),
      value: z.int(),
    }),
    proteinG: z.int(),
    fatG: z.int(),
    fiberG: z.int(),
    targets: z
      .object({
        kcal: z.int().describe('The daily budget'),
        proteinG: z.int(),
        fatG: z.int(),
        carbsG: z.int().describe('The energy left after protein and fat'),
        fiberG: z.int(),
      })
      .describe('Computed from the settings, rounded to whole kcal and grams'),
  })
  .describe('A daily goal and the targets it sets');

export type Goal = z.infer<typeof GoalSchema>;

export class GoalDto extends createZodDto(GoalSchema) {}

export class GoalListDto extends createZodDto(
  z
    .object({ items: z.array(GoalSchema) })
    .describe("The user's goals, latest start date first"),
) {}

export class GoalDateParamsDto extends createZodDto(
  z.object({ effectiveFrom: CalendarDateSchema }),
) {}

export class EffectiveGoalQueryDto extends createZodDto(
  z.object({
    date: CalendarDateSchema.describe(
      'The day to look up, as the client sees it (YYYY-MM-DD)',
    ),
  }),
) {}
