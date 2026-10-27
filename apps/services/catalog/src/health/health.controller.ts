import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /** Liveness: is the process responsive? Never checks dependencies. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Readiness: can the service handle requests? Checks its dependencies. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
