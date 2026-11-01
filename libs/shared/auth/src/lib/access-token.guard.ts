import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import {
  AccessTokenVerifier,
  InvalidAccessToken,
} from './access-token-verifier';
import { PUBLIC_ROUTE, type RequestWithViewer } from './viewer';

/**
 * Establishes the viewer for every request, from an `Authorization: Bearer <token>`
 * header (RFC 6750). Register it as APP_GUARD, with an AccessTokenVerifier provider:
 *   - no token: allowed on @Public() routes (viewer null), 401 everywhere else
 *   - a token: verified on every route; an invalid one is a 401 even where it wasn't
 *     needed, so a client never mistakes "my token is broken" for "anonymous"
 * What a viewer may do is still the endpoints' and services' decision.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RequestWithViewer>();
    const response = context.switchToHttp().getResponse<Response>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const header = request.headers.authorization;
    if (header === undefined) {
      if (isPublic) {
        request.viewer = null;
        return true;
      }
      response.set('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException(
        'Sign in: send an access token as "Authorization: Bearer <token>"',
      );
    }

    const token = /^Bearer ([\w.~+/-]+=*)$/i.exec(header)?.[1];
    if (!token) return this.refuse(response, 'invalid', 'not a Bearer header');
    try {
      request.viewer = await this.verifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessToken) {
        return this.refuse(response, error.reason, error.detail);
      }
      // Identity's keys are unreachable: not the client's fault, and it may pass
      this.logger.error({ err: error }, 'Access tokens cannot be verified');
      throw new ServiceUnavailableException(
        'Sign-in is unavailable right now; try again shortly',
      );
    }
  }

  private refuse(
    response: Response,
    reason: InvalidAccessToken['reason'],
    detail: string,
  ): never {
    // The reason for the logs; the token itself never
    this.logger.warn({ reason, detail }, 'Access token refused');
    const description =
      reason === 'expired'
        ? 'The access token expired'
        : 'Invalid access token';
    response.set(
      'WWW-Authenticate',
      `Bearer error="invalid_token", error_description="${description}"`,
    );
    throw new UnauthorizedException(description);
  }
}
