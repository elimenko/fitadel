import { redactUrl } from './secret-query-params';

describe('redactUrl', () => {
  it('hides link tokens and keeps everything else', () => {
    expect(redactUrl('/verify-email?token=abc-123_x')).toBe(
      '/verify-email?token=[redacted]',
    );
    expect(redactUrl('/x?a=1&token=abc&b=2#top')).toBe(
      '/x?a=1&token=[redacted]&b=2#top',
    );
    expect(redactUrl('/oidc/auth?client_id=fitadel-dev&state=s')).toBe(
      '/oidc/auth?client_id=fitadel-dev&state=s',
    );
    expect(redactUrl('/x?mytoken=abc')).toBe('/x?mytoken=abc');
  });
});
