import type { ReactNode } from 'react';
import { REGISTRATION_LINK_HOURS } from '../account/emails';
import { PASSWORD_MIN_LENGTH } from '../account/password-policy';
import { CONFIRM_EMAIL_SCRIPT } from './scripts';
import { STYLES } from './styles';

function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Fitadel`}</title>
        {/* Our own constant, allowed by its hash in the Content Security Policy */}
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

export interface SignInPageProps {
  uid: string;
  /** Kept after a failed attempt, so the user only retypes the password */
  email?: string;
  error?: string;
}

export function SignInPage({ uid, email, error }: SignInPageProps) {
  return (
    <Layout title="Sign in">
      <h1>Sign in to Fitadel</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form method="post" action={`/interaction/${uid}/login`}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email}
          required
          autoFocus={!email}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={Boolean(email)}
        />
        <button type="submit">Sign in</button>
      </form>
      <p>
        New to Fitadel?{' '}
        <a href={`/interaction/${uid}/register`}>Create an account</a>
      </p>
      <p>
        <a href={`/interaction/${uid}/abort`}>Cancel</a>
      </p>
    </Layout>
  );
}

export interface RegisterPageProps {
  uid: string;
  /** Kept after a failed attempt; the password never is */
  email?: string;
  displayName?: string;
  error?: string;
}

export function RegisterPage({
  uid,
  email,
  displayName,
  error,
}: RegisterPageProps) {
  return (
    <Layout title="Create an account">
      <h1>Create a Fitadel account</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form method="post" action={`/interaction/${uid}/register`}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email}
          required
          autoFocus={!email}
        />
        <label htmlFor="displayName">Name (optional)</label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="name"
          defaultValue={displayName}
        />
        <label htmlFor="password">Password</label>
        {/* No maxLength: it would silently cut a pasted password; the server checks */}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          aria-describedby="password-hint"
          required
          autoFocus={Boolean(email)}
        />
        <p id="password-hint" className="hint">
          At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words are
          easy to remember and hard to guess.
        </p>
        <button type="submit">Create account</button>
      </form>
      <p>
        Already have an account? <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

/**
 * After the registration form, whether the address is new or already has an account:
 * the same page either way, so it reveals nothing. It stays in the sign-in flow, so
 * signing in after confirming continues to the app.
 */
export function CheckEmailPage({ uid, email }: { uid: string; email: string }) {
  return (
    <Layout title="Check your email">
      <h1>Check your email</h1>
      <p>
        We sent an email to <strong>{email}</strong>. Open the link in it to
        finish creating your account; it expires in {REGISTRATION_LINK_HOURS}{' '}
        hours.
      </p>
      <p className="hint">
        Nothing arrived after a few minutes? Check your spam folder, or go back
        and check the address.
      </p>
      <p>
        Confirmed your email? <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

/**
 * What the emailed link opens. Mail scanners open every link in an email; a page with
 * a button uses nothing up, only the button's POST does. The token stays in the
 * browser (the link's fragment) until then: the script puts it in the form.
 */
export function ConfirmEmailPage() {
  return (
    <Layout title="Confirm your email">
      <h1>Confirm your email</h1>
      <p>One last step to create your Fitadel account.</p>
      <form method="post" action="/verify-email">
        <input type="hidden" id="token" name="token" />
        <button type="submit" id="confirm" disabled>
          Confirm email
        </button>
      </form>
      <noscript>
        <p className="error">
          Turn on JavaScript to confirm: it reads the code from the link in your
          browser, so it never travels in a web address.
        </p>
      </noscript>
      <script dangerouslySetInnerHTML={{ __html: CONFIRM_EMAIL_SCRIPT }} />
    </Layout>
  );
}

export function NoticePage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Layout title={title}>
      <h1>{title}</h1>
      {children}
    </Layout>
  );
}

export function ErrorPage({ message }: { message: string }) {
  return (
    <Layout title="Something went wrong">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </Layout>
  );
}
