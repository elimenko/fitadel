import { z } from 'zod';

/**
 * The event settings, the same in every service that publishes or consumes (ADR-0012).
 * Spread into a service's env schema.
 */
export const eventsEnvShape = {
  /**
   * Off when unset: no Kafka needed, nothing recorded or consumed. Events only feed
   * hints (such as ranking), so the app works the same without them.
   */
  EVENTS_ENABLED: z.stringbool().default(false),
  /** Comma-separated host:port of the Kafka brokers to bootstrap from */
  KAFKA_BROKERS: z
    .string()
    .default('localhost:9092')
    .transform((value) => value.split(',').map((broker) => broker.trim()))
    .pipe(
      z
        .array(
          z
            .string()
            .regex(/^[\w.-]+:\d+$/, 'Use host:port, e.g. localhost:9092'),
        )
        .min(1),
    ),
};
