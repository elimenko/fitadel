import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/viewer';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';

@ApiTags('health')
// Probes from Kubernetes and load balancers carry no token
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

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
    return this.health.check([() => this.database.isReachable()]);
  }
}
