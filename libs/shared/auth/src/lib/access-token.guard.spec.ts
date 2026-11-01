import {
  type ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { errors } from 'jose';
import {
  type AccessTokenVerifier,
  InvalidAccessToken,
} from './access-token-verifier';
import { AccessTokenGuard } from './access-token.guard';
import type { RequestWithViewer, Viewer } from './viewer';

const VIEWER: Viewer = {
  id: '01a1924d-a9ab-7ada-b342-9b6b18aac278',
  roles: new Set(['contributor']),
};

const verify = jest.fn();
const isPublic = jest.fn();
const guard = new AccessTokenGuard(
  { getAllAndOverride: isPublic } as unknown as Reflector,
  { verify } as unknown as AccessTokenVerifier,
);

/** One HTTP request through the guard; returns what it set and the response headers */
async function run(authorization?: string) {
  const request = {
    headers: authorization ? { authorization } : {},
  } as RequestWithViewer;
  const headers: Record<string, string> = {};
  const response = {
    set: (name: string, value: string) => (headers[name] = value),
  };
  const context = {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  let allowed: boolean | undefined;
  let error: unknown;
  try {
    allowed = await guard.canActivate(context);
  } catch (e) {
    error = e;
  }
  return { allowed, error, viewer: request.viewer, headers };
}

beforeEach(() => {
  verify.mockReset();
  isPublic.mockReset();
});

describe('AccessTokenGuard', () => {
  it('sets the viewer from a valid token', async () => {
    verify.mockResolvedValue(VIEWER);

    const { allowed, viewer } = await run('Bearer a.b.c');

    expect(allowed).toBe(true);
    expect(viewer).toBe(VIEWER);
    expect(verify).toHaveBeenCalledWith('a.b.c');
  });

  it('lets a request without a token through on public routes only', async () => {
    isPublic.mockReturnValue(true);
    expect(await run()).toMatchObject({ allowed: true, viewer: null });

    isPublic.mockReturnValue(undefined);
    const closed = await run();
    expect(closed.error).toBeInstanceOf(UnauthorizedException);
    expect(closed.headers['WWW-Authenticate']).toBe('Bearer');
  });

  it('refuses an invalid token even on a public route', async () => {
    isPublic.mockReturnValue(true);
    verify.mockRejectedValue(new InvalidAccessToken('invalid', 'aud'));

    const { error, headers } = await run('Bearer a.b.c');

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer error="invalid_token", error_description="Invalid access token"',
    );
  });

  it('says when a token expired, so clients know to refresh', async () => {
    verify.mockRejectedValue(new InvalidAccessToken('expired', 'exp'));

    const { headers } = await run('Bearer a.b.c');

    expect(headers['WWW-Authenticate']).toContain(
      'error_description="The access token expired"',
    );
  });

  it('refuses other authorization schemes without asking the verifier', async () => {
    const { error } = await run('Basic dXNlcjpwYXNz');

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('answers 503, not 401, when identity’s keys are unreachable', async () => {
    verify.mockRejectedValue(new errors.JWKSTimeout());

    expect((await run('Bearer a.b.c')).error).toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
