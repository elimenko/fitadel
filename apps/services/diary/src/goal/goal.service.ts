import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException } from '@fitadel/shared-http';
import type { Goal as GoalRow } from '../generated/prisma/client';
import { fromDbDate, toDbDate } from '../calendar-date';
import { PrismaService } from '../prisma/prisma.service';
import {
  dailyTargets,
  type GoalSettings,
  UnreachableGoal,
} from './daily-targets';
import type { Goal } from './goal.dto';

/** A user's goals. Every query is scoped to the user: nobody sees another's goals. */
@Injectable()
export class GoalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Goal[]> {
    const rows = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map(toGoal);
  }

  async get(userId: string, effectiveFrom: string): Promise<Goal | null> {
    const row = await this.prisma.goal.findUnique({
      where: {
        userId_effectiveFrom: {
          userId,
          effectiveFrom: toDbDate(effectiveFrom),
        },
      },
    });
    return row && toGoal(row);
  }

  /** The goal in effect on a date: the latest one that started on or before it */
  async effectiveOn(userId: string, date: string): Promise<Goal | null> {
    const row = await this.prisma.goal.findFirst({
      where: { userId, effectiveFrom: { lte: toDbDate(date) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row && toGoal(row);
  }

  /** Creates the goal starting on that date, or replaces it */
  async put(
    userId: string,
    effectiveFrom: string,
    settings: GoalSettings,
  ): Promise<Goal> {
    try {
      dailyTargets(settings);
    } catch (error) {
      if (error instanceof UnreachableGoal) {
        throw new ProblemException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          error.message,
        );
      }
      throw error;
    }
    const values = {
      maintenanceKcal: settings.maintenanceKcal,
      adjustmentUnit: settings.adjustment.unit,
      adjustmentValue: settings.adjustment.value,
      proteinG: settings.proteinG,
      fatG: settings.fatG,
      fiberG: settings.fiberG,
    };
    const key = { userId, effectiveFrom: toDbDate(effectiveFrom) };
    // One statement (INSERT ... ON CONFLICT DO UPDATE): concurrent PUTs can't collide
    const row = await this.prisma.goal.upsert({
      where: { userId_effectiveFrom: key },
      create: { ...key, ...values },
      update: values,
    });
    return toGoal(row);
  }

  /** False when there was no such goal */
  async delete(userId: string, effectiveFrom: string): Promise<boolean> {
    const { count } = await this.prisma.goal.deleteMany({
      where: { userId, effectiveFrom: toDbDate(effectiveFrom) },
    });
    return count > 0;
  }
}

function toGoal(row: GoalRow): Goal {
  const settings: GoalSettings = {
    maintenanceKcal: row.maintenanceKcal,
    adjustment: { unit: row.adjustmentUnit, value: row.adjustmentValue },
    proteinG: row.proteinG,
    fatG: row.fatG,
    fiberG: row.fiberG,
  };
  return {
    effectiveFrom: fromDbDate(row.effectiveFrom),
    ...settings,
    targets: dailyTargets(settings),
  };
}
