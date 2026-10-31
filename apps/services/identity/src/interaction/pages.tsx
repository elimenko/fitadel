import type { ReactNode } from 'react';
import { PASSWORD_MIN_LENGTH } from '../account/password-policy';
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

export function ErrorPage({ message }: { message: string }) {
  return (
    <Layout title="Something went wrong">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </Layout>
  );
}
