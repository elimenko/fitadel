import type { ReactNode } from 'react';
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
        <a href={`/interaction/${uid}/abort`}>Cancel</a>
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
