import { Injectable } from '@nestjs/common';
import { ProblemException } from '@fitadel/shared-http';
import type { DiaryEntry, Meal } from '../generated/prisma/client';
import { fromDbDate, toDbDate } from '../calendar-date';
import {
  type CatalogFood,
  CatalogFoods,
  type OnBehalfOf,
} from '../catalog/catalog-foods';
import { GoalService } from '../goal/goal.service';
import {
  type Answer,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { summarizeDay, sumValues } from './day-summary';
import {
  type CopyEntries,
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
    private readonly idempotency: IdempotencyService,
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

  /**
   * A food entry asks the catalog for the food, on the user's behalf. A retry with the
   * same Idempotency-Key gets the first answer, before any catalog call.
   */
  async create(
    userId: string,
    date: string,
    entry: NewEntry,
    user: OnBehalfOf,
    key?: string,
  ): Promise<Answer<Entry>> {
    const keyed = { userId, key, request: ['create', date, entry] };
    const replayed = await this.idempotency.replay<Entry>(keyed);
    if (replayed) return replayed;

    const data =
      entry.kind === 'manual'
        ? manualColumns(entry)
        : foodColumns(entry, await this.snapshotOf(entry.foodId, user));
    return this.idempotency.save(keyed, 201, async (db) =>
      toEntry(
        await db.diaryEntry.create({
          data: { userId, date: toDbDate(date), ...data },
        }),
      ),
    );
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

  /**
   * Copies entries of the user's diary to a day, all or none. Every copy goes into one
   * INSERT, and a single statement is atomic; the only transaction is the one that
   * stores an Idempotency-Key with it. The sources are read first, and a source deleted
   * in between is still copied as it was read. A copy keeps its source's values and
   * food copy, so the catalog isn't asked. A retry with the same key gets the first
   * answer, even if the sources are gone by then.
   */
  async copy(
    userId: string,
    date: string,
    copies: CopyEntries,
    key?: string,
  ): Promise<Answer<Entry[]>> {
    const keyed = { userId, key, request: ['copy', date, copies] };
    const replayed = await this.idempotency.replay<Entry[]>(keyed);
    if (replayed) return replayed;

    const { entryIds, meal } = copies;
    const sources = await this.prisma.diaryEntry.findMany({
      where: { userId, id: { in: entryIds } },
    });
    const found = new Set(sources.map((row) => row.id));
    const missing = entryIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new ProblemException(422, 'No such entries in your diary', {
        // Someone else's entries look the same: their existence isn't revealed
        entryIds: missing,
      });
    }

    const order = (id: string) => entryIds.indexOf(id);
    sources.sort((a, b) => order(a.id) - order(b.id));
    return this.idempotency.save(keyed, 201, async (db) => {
      const rows = await db.diaryEntry.createManyAndReturn({
        data: sources.map((source) => copyOf(source, toDbDate(date), meal)),
      });
      // uuidv7 ids follow the order the rows were inserted in, the order asked
      return rows.sort((a, b) => (a.id < b.id ? -1 : 1)).map(toEntry);
    });
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

/**
 * A new entry with every value of the source: only the day and maybe the meal differ.
 * The return type lists every column but the row's own, so a new column can't be
 * forgotten here.
 */
function copyOf(
  source: DiaryEntry,
  date: Date,
  meal: Meal | undefined,
): Omit<DiaryEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    userId: source.userId,
    date,
    meal: meal ?? source.meal,
    name: source.name,
    kcal: source.kcal,
    proteinG: source.proteinG,
    fatG: source.fatG,
    carbsG: source.carbsG,
    fiberG: source.fiberG,
    foodId: source.foodId,
    amount: source.amount,
    brand: source.brand,
    basis: source.basis,
    kcalPer100: source.kcalPer100,
    proteinPer100: source.proteinPer100,
    fatPer100: source.fatPer100,
    carbsPer100: source.carbsPer100,
    fiberPer100: source.fiberPer100,
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
