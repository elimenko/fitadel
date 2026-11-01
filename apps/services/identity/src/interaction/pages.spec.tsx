import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckEmailPage, ConfirmEmailPage, SignInPage } from './pages';
import { STYLES, STYLES_HASH } from './styles';

describe('SignInPage', () => {
  it('posts to the interaction it belongs to', () => {
    const html = renderToStaticMarkup(<SignInPage uid="abc123" />);

    expect(html).toContain('action="/interaction/abc123/login"');
    // HTML attribute names are case-insensitive; React keeps the camelCase
    expect(html).toContain('autoComplete="current-password"');
  });

  it('escapes what the user typed, so it cannot become markup', () => {
    const html = renderToStaticMarkup(
      <SignInPage uid="u" email={'"><script>alert(1)</script>'} error="Nope" />,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('role="alert"');
  });

  it('includes exactly the stylesheet the Content Security Policy allows', () => {
    const html = renderToStaticMarkup(<SignInPage uid="u" />);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];

    expect(style).toBe(STYLES);
    expect(STYLES_HASH).toBe(
      `'sha256-${createHash('sha256')
        .update(style ?? '')
        .digest('base64')}'`,
    );
  });
});

describe('registration pages', () => {
  it('keeps "check your email" inside the sign-in flow', () => {
    const html = renderToStaticMarkup(
      <CheckEmailPage uid="abc123" email="a@b.c" />,
    );

    expect(html).toContain('href="/interaction/abc123"');
    expect(html).toContain('<strong>a@b.c</strong>');
  });

  it('confirms with a POST, so opening the link uses nothing up', () => {
    const html = renderToStaticMarkup(<ConfirmEmailPage token="t0k3n" />);

    expect(html).toContain('action="/verify-email" method="post"');
    expect(html).toContain('type="hidden" name="token" value="t0k3n"');
  });
});
