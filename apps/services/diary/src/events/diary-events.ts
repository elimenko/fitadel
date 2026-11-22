import { FOOD_LOGGED_TOPIC, FoodLogged } from '@fitadel/diary-events';
import type { Db } from '../prisma/prisma.service';
import { uuidv7 } from './uuidv7';

export interface LoggedFood {
  foodId: string;
  loggedAt: Date;
}

/**
 * Records the diary's events in the transaction of the change they announce, so the
 * change and its events commit together (ADR-0012). Entry code calls this and never
 * touches Kafka; whether events are on is decided once, by EVENTS_ENABLED.
 */
export abstract class DiaryEvents {
  /** Food entries were logged (new or copied): one FoodLogged each */
  abstract foodsLogged(db: Db, foods: LoggedFood[]): Promise<void>;
}

/** Events on: each event is an outbox row, which the relay publishes */
export class OutboxEvents extends DiaryEvents {
  async foodsLogged(db: Db, foods: LoggedFood[]): Promise<void> {
    if (foods.length === 0) return;
    await db.outboxEvent.createMany({
      data: foods.map(({ foodId, loggedAt }) => {
        const id = uuidv7(loggedAt.getTime());
        const event = { eventId: id, foodId, loggedAt };
        return {
          id,
          topic: FOOD_LOGGED_TOPIC,
          key: foodId,
          payload: new Uint8Array(FoodLogged.encode(event).finish()),
        };
      }),
    });
  }
}

/** Events off: nothing is recorded, so nothing piles up with no relay to send it */
export class NoEvents extends DiaryEvents {
  async foodsLogged(): Promise<void> {
    // Intentionally nothing
  }
}
