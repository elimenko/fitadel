import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type Role = 'contributor';

/**
 * Who is making the request, as endpoints see it. How it's established is the auth
 * guard's job: development headers now, a verified login token from Phase 2 on.
 * Endpoints and services only ever depend on this shape.
 */
export interface Viewer {
  id: string;
  roles: ReadonlySet<Role>;
}

/** May create public (community) foods */
export const isContributor = (viewer: Viewer | null): boolean =>
  viewer?.roles.has('contributor') ?? false;

/** Where the auth guard stores the viewer for the rest of the request */
export interface RequestWithViewer extends Request {
  viewer?: Viewer | null;
}

/** The current viewer, or null for anonymous requests */
export const CurrentViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer | null =>
    context.switchToHttp().getRequest<RequestWithViewer>().viewer ?? null,
);
