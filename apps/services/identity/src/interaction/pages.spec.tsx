import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CheckEmailPage,
  ConfirmEmailPage,
  ResetPasswordPage,
  SignInPage,
} from './pages';
import { LINK_TOKEN_SCRIPT, LINK_TOKEN_SCRIPT_HASH } from './scripts';
import { STYLES, STYLES_HASH } from './styles';

describe('SignInPage', () => {
  it('posts to the interaction it belongs to', () => {
    const html = renderToStaticMarkup(<SignInPage uid="abc123" />);

    expect(html).toContain('action="/interaction/abc123/login"');
    // HTML attribute names are case-insensitive; React keeps the camelCase
    expect(html).toContain('autoComplete="current-password"');
  });

  it('offers Google only when it is configured, as a POST to the interaction', () => {
    expect(renderToStaticMarkup(<SignInPage uid="u" />)).not.toContain(
      'Google',
    );
    expect(renderToStaticMarkup(<SignInPage uid="u" google />)).toContain(
      'action="/interaction/u/google"',
    );
  });

  it('asks for the password to connect Google, without offering Google again', () => {
    const html = renderToStaticMarkup(
      <SignInPage uid="u" email="bob@gmail.com" google linkingGoogle />,
    );

    expect(html).toContain('Connect Google');
    expect(html).toContain('value="bob@gmail.com"');
    expect(html).not.toContain('action="/interaction/u/google"');
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
      <CheckEmailPage uid="abc123" email="a@b.c" purpose="register" />,
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

    expect(script).toBe(LINK_TOKEN_SCRIPT);
    expect(LINK_TOKEN_SCRIPT_HASH).toBe(
      `'sha256-${createHash('sha256')
        .update(script ?? '')
        .digest('base64')}'`,
    );
  });
});

describe('password reset pages', () => {
  it('offers a reset from the sign-in page, inside the flow', () => {
    const html = renderToStaticMarkup(<SignInPage uid="abc123" />);

    expect(html).toContain('href="/interaction/abc123/forgot"');
  });

  it('waits for the script before the token is there', () => {
    const html = renderToStaticMarkup(<ResetPasswordPage />);

    expect(html).toContain('action="/reset-password" method="post"');
    expect(html).toContain('<input type="hidden" id="token" name="token"/>');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('autoComplete="new-password"');
    expect(/<script>([\s\S]*?)<\/script>/.exec(html)?.[1]).toBe(
      LINK_TOKEN_SCRIPT,
    );
  });

  it('keeps the token in the page body after a rejected password', () => {
    const html = renderToStaticMarkup(
      <ResetPasswordPage token="t0k3n" error="Use at least 8 characters." />,
    );

    expect(html).toContain('name="token" value="t0k3n"');
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain('role="alert"');
  });
});
