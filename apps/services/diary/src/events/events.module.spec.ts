import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DiaryEvents, NoEvents, OutboxEvents } from './diary-events';
import { EventsModule } from './events.module';
import { OutboxRelay } from './outbox-relay';

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

  it('records nothing and starts no relay when events are off', async () => {
    const moduleRef = await moduleWith(false);
    expect(moduleRef.get(DiaryEvents)).toBeInstanceOf(NoEvents);
    expect(moduleRef.get(OutboxRelay)).toBeNull();
    await moduleRef.close();
  });

  it('writes to the outbox and has a relay when events are on', async () => {
    const moduleRef = await moduleWith(true);
    expect(moduleRef.get(DiaryEvents)).toBeInstanceOf(OutboxEvents);
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
    await moduleRef.close();
  });
});
