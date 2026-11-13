import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { RequestWithViewer, Viewer } from '@fitadel/shared-auth';

export type { Viewer } from '@fitadel/shared-auth';

/**
 * The signed-in user. Every diary route needs a token, so AccessTokenGuard has set the
 * viewer; a route marked @Public() by mistake answers 401 instead of serving no one's
 * data.
 */
export const SignedInViewer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Viewer => {
    const viewer = context
      .switchToHttp()
      .getRequest<RequestWithViewer>().viewer;
    if (!viewer) throw new UnauthorizedException('Sign in first');
    return viewer;
  },
);
