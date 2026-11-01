import { PublicUrl } from './public-url';

describe('PublicUrl', () => {
  it('links next to the issuer, keeping a path prefix', () => {
    expect(
      new PublicUrl('http://localhost:3010/oidc').link('verify-email', {
        token: 'a b',
      }),
    ).toBe('http://localhost:3010/verify-email?token=a+b');
    expect(
      new PublicUrl('https://fitadel.example/auth/oidc/').link('verify-email'),
    ).toBe('https://fitadel.example/auth/verify-email');
  });
});
