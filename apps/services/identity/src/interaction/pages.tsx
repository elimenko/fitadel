import type { ReactNode } from 'react';
import { REGISTRATION_LINK_HOURS, RESET_LINK_MINUTES } from '../account/emails';
import { PASSWORD_MIN_LENGTH } from '../account/password-policy';
import { LINK_TOKEN_SCRIPT } from './scripts';
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
        <a href={`/interaction/${uid}/forgot`}>Forgot your password?</a>
      </p>
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
        <NewPasswordInput label="Password" autoFocus={Boolean(email)} />
        <button type="submit">Create account</button>
      </form>
      <p>
        Already have an account? <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

function NewPasswordInput({
  label,
  autoFocus,
}: {
  label: string;
  autoFocus: boolean;
}) {
  return (
    <>
      <label htmlFor="password">{label}</label>
      {/* No maxLength: it would silently cut a pasted password; the server checks */}
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        aria-describedby="password-hint"
        required
        autoFocus={autoFocus}
      />
      <p id="password-hint" className="hint">
        At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words are
        easy to remember and hard to guess.
      </p>
    </>
  );
}

const CHECK_EMAIL = {
  register: {
    action: 'finish creating your account',
    expires: `${REGISTRATION_LINK_HOURS} hours`,
    done: 'Confirmed your email?',
  },
  reset: {
    action: 'choose a new password',
    expires: `${RESET_LINK_MINUTES} minutes`,
    done: 'Changed your password?',
  },
};

/**
 * After the registration or "forgot password" form, whether the address has an
 * account or not: the same page either way, so it reveals nothing. It stays in the
 * sign-in flow, so signing in afterwards continues to the app.
 */
export function CheckEmailPage({
  uid,
  email,
  purpose,
}: {
  uid: string;
  email: string;
  purpose: keyof typeof CHECK_EMAIL;
}) {
  const text = CHECK_EMAIL[purpose];
  return (
    <Layout title="Check your email">
      <h1>Check your email</h1>
      <p>
        We sent an email to <strong>{email}</strong>. Open the link in it to{' '}
        {text.action}; it expires in {text.expires}.
      </p>
      <p className="hint">
        Nothing arrived after a few minutes? Check your spam folder, or go back
        and check the address.
      </p>
      <p>
        {text.done} <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

/**
 * A correct password that has appeared in a data breach: the sign-in stops here and a
 * reset link goes to the inbox. Honest about why, so the owner changes it elsewhere too.
 */
export function BreachedPasswordPage({
  uid,
  email,
}: {
  uid: string;
  email: string;
}) {
  return (
    <Layout title="Choose a new password">
      <h1>Choose a new password</h1>
      <p>
        Your password is right, but it has appeared in a data breach on another
        site, so attackers try it everywhere. To keep your account safe, we sent
        a link to <strong>{email}</strong> to choose a new one; it expires in{' '}
        {RESET_LINK_MINUTES} minutes.
      </p>
      <p>If you use this password anywhere else, change it there too.</p>
      <p>
        Changed it? <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

export function ForgotPasswordPage({
  uid,
  email,
  error,
}: {
  uid: string;
  email?: string;
  error?: string;
}) {
  return (
    <Layout title="Reset your password">
      <h1>Reset your password</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>We'll email you a link to choose a new password.</p>
      <form method="post" action={`/interaction/${uid}/forgot`}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email}
          required
          autoFocus
        />
        <button type="submit">Send link</button>
      </form>
      <p>
        Remembered it? <a href={`/interaction/${uid}`}>Sign in</a>
      </p>
    </Layout>
  );
}

/**
 * The token reaches the form from the link's fragment (see LINK_TOKEN_SCRIPT), or from
 * the server when the form comes back with an error: then it's in this page's body,
 * never in a URL.
 */
function LinkTokenField({ token }: { token?: string }) {
  return <input type="hidden" id="token" name="token" defaultValue={token} />;
}

function LinkTokenScript() {
  return (
    <>
      <noscript>
        <p className="error">
          Turn on JavaScript to continue: it reads the code from the link in
          your browser, so it never travels in a web address.
        </p>
      </noscript>
      <script dangerouslySetInnerHTML={{ __html: LINK_TOKEN_SCRIPT }} />
    </>
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
        <LinkTokenField />
        <button type="submit" id="submit" disabled>
          Confirm email
        </button>
      </form>
      <LinkTokenScript />
    </Layout>
  );
}

/**
 * What the reset link opens. Choosing the password is the deliberate step a scanner
 * won't take, so no separate confirm button is needed.
 */
export function ResetPasswordPage({
  token,
  error,
}: {
  token?: string;
  error?: string;
}) {
  return (
    <Layout title="Choose a new password">
      <h1>Choose a new password</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form method="post" action="/reset-password">
        <LinkTokenField token={token} />
        <NewPasswordInput label="New password" autoFocus />
        <button type="submit" id="submit" disabled={!token}>
          Change password
        </button>
      </form>
      <p className="hint">
        Every device signed in to your account is signed out.
      </p>
      <LinkTokenScript />
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
