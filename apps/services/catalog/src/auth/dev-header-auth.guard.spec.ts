import { UnauthorizedException } from '@nestjs/common';
import { viewerFromHeaders } from './dev-header-auth.guard';

const ID = '0192f8a4-6a3e-7c00-8f00-000000000001';

describe('viewerFromHeaders', () => {
  it('is anonymous without headers', () => {
    expect(viewerFromHeaders({})).toBeNull();
  });

  it('reads the user id and roles', () => {
    const viewer = viewerFromHeaders({
      'x-dev-user-id': ID.toUpperCase(),
      'x-dev-roles': ' contributor ',
    });
    expect(viewer?.id).toBe(ID);
    expect([...(viewer?.roles ?? [])]).toEqual(['contributor']);
  });

  it('has no roles unless given', () => {
    expect(viewerFromHeaders({ 'x-dev-user-id': ID })?.roles.size).toBe(0);
  });

  it('rejects a malformed id and unknown roles', () => {
    expect(() => viewerFromHeaders({ 'x-dev-user-id': 'egor' })).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      viewerFromHeaders({ 'x-dev-user-id': ID, 'x-dev-roles': 'admin' }),
    ).toThrow(/Unknown role/);
  });
});
