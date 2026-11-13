import { Injectable } from '@nestjs/common';
import type { DiaryEntry } from '../generated/prisma/client';
import { fromDbDate, toDbDate } from '../calendar-date';
import { GoalService } from '../goal/goal.service';
import { PrismaService } from '../prisma/prisma.service';
import { summarizeDay, sumValues } from './day-summary';
import {
  type Day,
  type Entry,
  type EntryChange,
  type ManualEntry,
  MEALS,
} from './day.dto';

/** A user's diary. Every query is scoped to the user: nobody sees another's entries. */
@Injectable()
export class EntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalService,
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

  async create(
    userId: string,
    date: string,
    entry: ManualEntry,
  ): Promise<Entry> {
    const row = await this.prisma.diaryEntry.create({
      data: { userId, date: toDbDate(date), ...entry },
    });
    return toEntry(row);
  }

  /** Null when the user has no such entry */
  async replace(
    userId: string,
    id: string,
    { date, ...entry }: EntryChange,
  ): Promise<Entry | null> {
    const { count } = await this.prisma.diaryEntry.updateMany({
      where: { id, userId },
      data: { date: toDbDate(date), ...entry },
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
}

function toEntry(row: DiaryEntry): Entry {
  const grams = (value: DiaryEntry['proteinG']) =>
    value === null ? null : value.toNumber();
  return {
    id: row.id,
    date: fromDbDate(row.date),
    meal: row.meal,
    name: row.name,
    kcal: row.kcal.toNumber(),
    proteinG: grams(row.proteinG),
    fatG: grams(row.fatG),
    carbsG: grams(row.carbsG),
    fiberG: grams(row.fiberG),
  };
}
