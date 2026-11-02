import * as client from 'openid-client';

/** Who an external provider says signed in */
export interface ExternalIdentity {
  issuer: string;
  subject: string;
  email?: string;
  /** The provider vouches that the person controls the email address */
  emailVerified: boolean;
  name?: string;
}

/** The values one sign-in attempt must present again in its callback */
export interface AttemptChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleClientOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Registered with Google exactly; also sent to its token endpoint */
  redirectUri: string;
  timeoutSeconds?: number;
}

/**
 * Identity's side of "Sign in with Google": an OpenID Connect client of Google, like
 * fitadel-dev is a client of identity. Authorization code flow with PKCE, `state` and
 * `nonce`; openid-client validates Google's ID token (signature, iss, aud, exp, nonce).
 */
export class GoogleClient {
  private configuration?: Promise<client.Configuration>;

  constructor(private readonly options: GoogleClientOptions) {}

  get redirectUri(): string {
    return this.options.redirectUri;
  }

  /** Where to send the browser to sign in at Google */
  async authorizationUrl(checks: AttemptChecks): Promise<URL> {
    return client.buildAuthorizationUrl(await this.config(), {
      redirect_uri: this.options.redirectUri,
      scope: 'openid email profile',
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(
        checks.codeVerifier,
      ),
      code_challenge_method: 'S256',
    });
  }

  /**
   * Exchanges the code in Google's redirect for tokens and returns the identity in the
   * validated ID token. Throws when Google reports an error (e.g. the user cancelled)
   * or any check fails.
   */
  async identityFromCallback(
    callbackUrl: URL,
    checks: AttemptChecks,
  ): Promise<ExternalIdentity> {
    const tokens = await client.authorizationCodeGrant(
      await this.config(),
      callbackUrl,
      {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims) throw new Error('No ID token in the token response');
    return {
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  }

  /** Google's metadata, discovered on first use; a failed discovery is retried next time */
  private config(): Promise<client.Configuration> {
    this.configuration ??= client
      .discovery(
        new URL(this.options.issuer),
        this.options.clientId,
        this.options.clientSecret,
        undefined,
        {
          timeout: this.options.timeoutSeconds ?? 5,
          // Only a local fake runs on plain http; Google itself is https
          execute: this.options.issuer.startsWith('http:')
            ? [client.allowInsecureRequests]
            : [],
        },
      )
      .catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }
}
