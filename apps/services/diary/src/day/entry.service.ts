import { Injectable } from '@nestjs/common';
import { ProblemException } from '@fitadel/shared-http';
import type { DiaryEntry } from '../generated/prisma/client';
import { fromDbDate, toDbDate } from '../calendar-date';
import {
  type CatalogFood,
  CatalogFoods,
  type OnBehalfOf,
} from '../catalog/catalog-foods';
import { GoalService } from '../goal/goal.service';
import { PrismaService } from '../prisma/prisma.service';
import { summarizeDay, sumValues } from './day-summary';
import {
  type Day,
  type Entry,
  type EntryChange,
  type FoodEntryInput,
  MEALS,
  type NewEntry,
} from './day.dto';
import { valuesFor } from './food-values';

/** The food columns of a row; all null for a manual entry */
type FoodColumns = Pick<
  DiaryEntry,
  | 'foodId'
  | 'amount'
  | 'brand'
  | 'basis'
  | 'kcalPer100'
  | 'proteinPer100'
  | 'fatPer100'
  | 'carbsPer100'
  | 'fiberPer100'
>;

/** A food entry's copy of the food, as stored */
interface Snapshot {
  id: string;
  name: string;
  brand: string | null;
  basis: 'g' | 'ml';
  per100: CatalogFood['per100'];
}

const NO_FOOD = {
  foodId: null,
  amount: null,
  brand: null,
  basis: null,
  kcalPer100: null,
  proteinPer100: null,
  fatPer100: null,
  carbsPer100: null,
  fiberPer100: null,
} satisfies Record<keyof FoodColumns, null>;

/** A user's diary. Every query is scoped to the user: nobody sees another's entries. */
@Injectable()
export class EntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalService,
    private readonly catalog: CatalogFoods,
  ) {}

  /** The day's entries by meal, with totals against the goal in effect */
  async day(userId: string, date: string): Promise<Day> {
    const [rows, goal] = await Promise.all([
      this.prisma.diaryEntry.findMany({
        where: { userId, date: toDbDate(date) },
        // uuidv7 ids sort by creation time
        orderBy: { id: 'asc' },
      }),
      this.goals.effectiveOn(userId, date),
    ]);
    const entries = rows.map(toEntry);
    const targets = goal?.targets ?? null;
    const meal = (name: (typeof MEALS)[number]) => {
      const inMeal = entries.filter((entry) => entry.meal === name);
      return { entries: inMeal, totals: sumValues(inMeal) };
    };
    return {
      date,
      meals: {
        breakfast: meal('breakfast'),
        lunch: meal('lunch'),
        dinner: meal('dinner'),
        snack: meal('snack'),
      },
      targets,
      ...summarizeDay(entries, targets),
    };
  }

  async get(userId: string, id: string): Promise<Entry | null> {
    const row = await this.prisma.diaryEntry.findFirst({
      where: { id, userId },
    });
    return row && toEntry(row);
  }

  /** A food entry asks the catalog for the food, on the user's behalf */
  async create(
    userId: string,
    date: string,
    entry: NewEntry,
    user: OnBehalfOf,
  ): Promise<Entry> {
    const data =
      entry.kind === 'manual'
        ? manualColumns(entry)
        : foodColumns(entry, await this.snapshotOf(entry.foodId, user));
    const row = await this.prisma.diaryEntry.create({
      data: { userId, date: toDbDate(date), ...data },
    });
    return toEntry(row);
  }

  /**
   * Null when the user has no such entry. The same food keeps the copy made when it
   * was logged, so a new amount uses the values the user saw then and needs no
   * catalog; a different food is copied anew.
   */
  async replace(
    userId: string,
    id: string,
    { date, ...entry }: EntryChange,
    user: OnBehalfOf,
  ): Promise<Entry | null> {
    const current = await this.prisma.diaryEntry.findFirst({
      where: { id, userId },
    });
    if (!current) return null;

    let data;
    if (entry.kind === 'manual') {
      data = manualColumns(entry);
    } else {
      const kept =
        current.foodId === entry.foodId ? storedSnapshot(current) : null;
      data = foodColumns(
        entry,
        kept ?? (await this.snapshotOf(entry.foodId, user)),
      );
    }
    const { count } = await this.prisma.diaryEntry.updateMany({
      where: { id, userId },
      data: { date: toDbDate(date), ...data },
    });
    return count > 0 ? this.get(userId, id) : null;
  }

  /** False when the user has no such entry */
  async delete(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.diaryEntry.deleteMany({
      where: { id, userId },
    });
    return count > 0;
  }

  private async snapshotOf(
    foodId: string,
    user: OnBehalfOf,
  ): Promise<Snapshot> {
    const food = await this.catalog.get(foodId, user);
    if (!food) {
      throw new ProblemException(422, 'No such food in the catalog', {
        // Someone else's private food looks the same: its existence isn't revealed
        foodId,
      });
    }
    return food;
  }
}

function manualColumns(entry: Extract<NewEntry, { kind: 'manual' }>) {
  const { meal, name, kcal, proteinG, fatG, carbsG, fiberG } = entry;
  return { meal, name, kcal, proteinG, fatG, carbsG, fiberG, ...NO_FOOD };
}

function foodColumns(
  { meal, amount }: Omit<FoodEntryInput, 'kind'>,
  food: Snapshot,
) {
  return {
    meal,
    name: food.name,
    ...valuesFor(food.per100, amount),
    foodId: food.id,
    amount,
    brand: food.brand,
    basis: food.basis,
    kcalPer100: food.per100.kcal,
    proteinPer100: food.per100.proteinG,
    fatPer100: food.per100.fatG,
    carbsPer100: food.per100.carbsG,
    fiberPer100: food.per100.fiberG,
  };
}

/** The copy of the food stored with a food entry; null for a manual one */
function storedSnapshot(row: DiaryEntry): Snapshot | null {
  if (row.foodId === null || row.basis === null || row.kcalPer100 === null) {
    return null;
  }
  return {
    id: row.foodId,
    name: row.name ?? '',
    brand: row.brand,
    basis: row.basis,
    per100: {
      kcal: row.kcalPer100.toNumber(),
      proteinG: decimal(row.proteinPer100),
      fatG: decimal(row.fatPer100),
      carbsG: decimal(row.carbsPer100),
      fiberG: decimal(row.fiberPer100),
    },
  };
}

const decimal = (value: DiaryEntry['proteinG']) =>
  value === null ? null : value.toNumber();

function toEntry(row: DiaryEntry): Entry {
  const snapshot = storedSnapshot(row);
  return {
    id: row.id,
    kind: snapshot ? 'food' : 'manual',
    date: fromDbDate(row.date),
    meal: row.meal,
    name: row.name,
    kcal: row.kcal.toNumber(),
    proteinG: decimal(row.proteinG),
    fatG: decimal(row.fatG),
    carbsG: decimal(row.carbsG),
    fiberG: decimal(row.fiberG),
    food:
      snapshot && row.amount
        ? {
            id: snapshot.id,
            amount: row.amount.toNumber(),
            basis: snapshot.basis,
            brand: snapshot.brand,
            per100: snapshot.per100,
          }
        : null,
  };
}
