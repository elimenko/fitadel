import { z } from 'zod';

/**
 * A calendar date, as the client means it: no time, no time zone. The client decides
 * which date "today" is; the service never converts dates to or from local time.
 */
export const CalendarDateSchema = z.iso
  .date('Use a date like 2026-11-15')
  .describe('A calendar date, YYYY-MM-DD');

/** Postgres DATE values travel through Prisma as Dates at midnight UTC */
export const toDbDate = (date: string): Date => new Date(`${date}T00:00:00Z`);

export const fromDbDate = (date: Date): string =>
  date.toISOString().slice(0, 10);
