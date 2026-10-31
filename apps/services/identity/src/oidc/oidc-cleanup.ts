import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deleteExpiredOidcPayloads } from './oidc-payload-adapter';

const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Deletes expired oidc_payload rows every 10 minutes. Every replica runs it; that's
 * harmless, as deleting expired rows twice deletes nothing the second time. A scheduled
 * job (e.g. a Kubernetes CronJob) can replace it later.
 */
@Injectable()
export class OidcCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OidcCleanup.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    try {
      const deleted = await deleteExpiredOidcPayloads(this.prisma);
      if (deleted > 0)
        this.logger.log({ deleted }, 'Deleted expired OIDC rows');
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of expired OIDC rows failed');
    }
  }
}
