import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { trustProxies } from './proxy';

@Controller()
class EchoIpController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function ipSeenWith(hops: number, forwardedFor: string) {
  const module = await Test.createTestingModule({
    controllers: [EchoIpController],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  trustProxies(app, hops);
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/ip`, {
      headers: { 'X-Forwarded-For': forwardedFor },
    });
    return ((await response.json()) as { ip: string }).ip;
  } finally {
    await app.close();
  }
}

describe('trustProxies', () => {
  it('takes the entry the gateway appended, not one the client forged', async () => {
    await expect(ipSeenWith(1, '6.6.6.6, 203.0.113.7')).resolves.toBe(
      '203.0.113.7',
    );
  });

  it('ignores the header when no proxy is trusted', async () => {
    await expect(ipSeenWith(0, '6.6.6.6')).resolves.toBe('127.0.0.1');
  });
});
