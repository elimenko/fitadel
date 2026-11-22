import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventsModule } from './events.module';
import { FoodLoggedConsumer } from './food-logged.consumer';

describe('EventsModule', () => {
  const moduleWith = (EVENTS_ENABLED: boolean) =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({
              EVENTS_ENABLED,
              KAFKA_BROKERS: ['localhost:9'],
              DATABASE_URL: 'postgresql://unused@localhost:5432/unused',
            }),
          ],
        }),
        EventsModule,
      ],
    }).compile();

  it('has no consumer when events are off', async () => {
    const moduleRef = await moduleWith(false);
    expect(moduleRef.get(FoodLoggedConsumer)).toBeNull();
    await moduleRef.close();
  });

  it('has a consumer when events are on', async () => {
    // Compiled, not started: no connection to Kafka is made
    const moduleRef = await moduleWith(true);
    expect(moduleRef.get(FoodLoggedConsumer)).toBeInstanceOf(
      FoodLoggedConsumer,
    );
    await moduleRef.close();
  });
});
