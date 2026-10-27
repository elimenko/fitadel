import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();
    controller = module.get(HealthController);
  });

  it('reports liveness as ok', async () => {
    await expect(controller.live()).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports readiness as ok', async () => {
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok' });
  });
});
