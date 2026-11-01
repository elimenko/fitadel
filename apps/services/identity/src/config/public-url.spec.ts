import { PublicUrl } from './public-url';

describe('PublicUrl', () => {
  it('links next to the issuer, keeping a path prefix', () => {
    expect(
      new PublicUrl('http://localhost:3010/oidc').link('verify-email'),
    ).toBe('http://localhost:3010/verify-email');
    expect(
      new PublicUrl('https://fitadel.example/auth/oidc/').link('verify-email'),
    ).toBe('https://fitadel.example/auth/verify-email');
  });

  it('puts values in the fragment, which browsers never send', () => {
    const link = new URL(
      new PublicUrl('http://localhost:3010/oidc').link('verify-email', {
        token: 'a b',
      }),
    );

    expect(link.search).toBe('');
    expect(link.hash).toBe('#token=a+b');
  });
});
