import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckEmailPage, ConfirmEmailPage, SignInPage } from './pages';
import { CONFIRM_EMAIL_SCRIPT, CONFIRM_EMAIL_SCRIPT_HASH } from './scripts';
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
    const html = renderToStaticMarkup(<ConfirmEmailPage />);

    expect(html).toContain('action="/verify-email" method="post"');
    // Filled in the browser from the link's fragment; the server never had it
    expect(html).toContain('<input type="hidden" id="token" name="token"/>');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('includes exactly the script its Content Security Policy allows', () => {
    const html = renderToStaticMarkup(<ConfirmEmailPage />);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

    expect(script).toBe(CONFIRM_EMAIL_SCRIPT);
    expect(CONFIRM_EMAIL_SCRIPT_HASH).toBe(
      `'sha256-${createHash('sha256')
        .update(script ?? '')
        .digest('base64')}'`,
    );
  });
});
