import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseHealthIndicator } from './database.health';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const queryRaw = jest.fn();
  let controller: HealthController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        DatabaseHealthIndicator,
        // A fake database client: no real Postgres in unit tests
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  beforeEach(() => queryRaw.mockReset());

  it('is ready when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('is not ready when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('stays live when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(controller.live()).resolves.toMatchObject({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
