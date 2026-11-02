import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Who is making the request, as endpoints see it: the account (`sub` of the access
 * token) and its roles. Endpoints and services depend on this shape only, never on
 * tokens.
 */
export interface Viewer {
  /** The account id, the same in every service */
  id: string;
  roles: ReadonlySet<string>;
}

/** Where AccessTokenGuard stores the viewer for the rest of the request */
export interface RequestWithViewer extends Request {
  viewer?: Viewer | null;
}

/** The current viewer, or null on a public route called without a token */
export const CurrentViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer | null =>
    context.switchToHttp().getRequest<RequestWithViewer>().viewer ?? null,
);

export const PUBLIC_ROUTE = 'fitadel:public-route';

/**
 * Lets requests without a token through (the viewer is then null). Every other route
 * requires one: a route nobody marked is closed, not open. A token that is sent is
 * always verified, public route or not. Behind the gateway, the route also needs an
 * entry in its public list (tools/gateway/envoy.yaml), or it still answers 401.
 */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
