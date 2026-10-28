import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { RequestWithViewer, Role, Viewer } from './viewer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set<Role>(['contributor']);

/**
 * Establishes the viewer for every request. Until Phase 2 brings real logins, and only
 * with AUTH_MODE=dev-headers (config refuses it in production), it trusts two headers:
 *   X-Dev-User-Id: <uuid>          who the request is from
 *   X-Dev-Roles: contributor       optional, comma-separated
 * Anyone can send these, which is why they must never be accepted in production.
 * Without them the request is anonymous. The guard never blocks by itself: deciding what
 * a viewer may do is the job of the endpoints and services.
 */
@Injectable()
export class DevHeaderAuthGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('AUTH_MODE', { infer: true }) === 'dev-headers';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithViewer>();
    request.viewer = this.enabled ? viewerFromHeaders(request.headers) : null;
    return true;
  }
}

export function viewerFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): Viewer | null {
  const id = single(headers['x-dev-user-id']);
  if (id === undefined) return null;
  if (!UUID.test(id)) {
    throw new UnauthorizedException('X-Dev-User-Id must be a UUID');
  }
  const roles = new Set<Role>();
  for (const role of (single(headers['x-dev-roles']) ?? '').split(',')) {
    const name = role.trim();
    if (!name) continue;
    if (!ROLES.has(name as Role)) {
      throw new UnauthorizedException(`Unknown role in X-Dev-Roles: ${name}`);
    }
    roles.add(name as Role);
  }
  return { id: id.toLowerCase(), roles };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
