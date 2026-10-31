import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RateLimiter } from './rate-limiter';

@Module({
  imports: [PrismaModule],
  providers: [RateLimiter],
  exports: [RateLimiter],
})
export class RateLimitModule {}
