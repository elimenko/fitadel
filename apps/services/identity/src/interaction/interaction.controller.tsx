import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import type { InteractionResults } from 'oidc-provider';
import type { ReactElement } from 'react';
import { z } from 'zod';
import { AccountService } from '../account/account.service';
import { PasswordResetService } from '../account/password-reset.service';
import {
  PASSWORD_MAX_LENGTH,
  PasswordPolicy,
} from '../account/password-policy';
import { RegistrationService } from '../account/registration.service';
import { FederationService } from '../federation/federation.service';
import { OIDC_PROVIDER } from '../oidc/oidc.module';
import {
  REGISTER_PER_EMAIL,
  REGISTER_PER_IP,
  RESET_PER_EMAIL,
  RESET_PER_IP,
  SIGN_IN_PER_EMAIL,
  SIGN_IN_PER_IP,
  emailKey,
  ipKey,
} from '../rate-limit/limits';
import { RateLimiter } from '../rate-limit/rate-limiter';
import { PASSWORD_PROBLEMS } from './messages';
import {
  BreachedPasswordPage,
  CheckEmailPage,
  ErrorPage,
  ForgotPasswordPage,
  RegisterPage,
  SignInPage,
  type SignInPageProps,
} from './pages';
import { renderPage } from './render';

const signInForm = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const registerForm = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  displayName: z.string().trim().max(100).optional(),
  // Length rules are PasswordPolicy's; this only bounds the input
  password: z.string().max(PASSWORD_MAX_LENGTH * 4),
});

const forgotForm = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
});

const EXPIRED =
  'This sign-in has expired or was opened in another browser. Go back to the app and start again.';

/**
 * The screens oidc-provider sends the browser to when it needs something from the user
 * (`/interaction/<uid>`): sign-in, and consent, which our own clients get automatically.
 * The interaction cookie ties a uid to this browser, so a form posted from elsewhere
 * finds no interaction (it doubles as CSRF protection).
 */
@Controller('interaction')
export class InteractionController {
  private readonly logger = new Logger(InteractionController.name);

  constructor(
    @Inject(OIDC_PROVIDER) private readonly provider: Provider,
    private readonly accounts: AccountService,
    private readonly registrations: RegistrationService,
    private readonly resets: PasswordResetService,
    private readonly passwords: PasswordPolicy,
    private readonly limiter: RateLimiter,
    private readonly federation: FederationService,
  ) {}

  @Get(':uid')
  async show(@Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res);
    if (!details) return;
    const { uid, prompt } = details;

    if (prompt.name === 'login') {
      return renderPage(
        res,
        200,
        <SignInPage uid={uid} google={this.federation.googleEnabled} />,
      );
    }
    if (prompt.name === 'consent') {
      return this.consent(req, res, details);
    }
    this.logger.warn({ prompt: prompt.name }, 'Unknown interaction prompt');
    return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
  }

  @Post(':uid/login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    // Back from Google to link an existing account: the page keeps saying so
    const linkingGoogle = await this.federation.isLinkPending(uid);
    const signInPage = (props: Omit<SignInPageProps, 'uid'>) => (
      <SignInPage
        uid={uid}
        google={this.federation.googleEnabled}
        linkingGoogle={linkingGoogle}
        {...props}
      />
    );

    const form = signInForm.safeParse(body);
    if (!form.success) {
      return renderPage(
        res,
        400,
        signInPage({ error: 'Enter your email and password.' }),
      );
    }
    const { email, password } = form.data;
    const again = (error: string) => signInPage({ email, error });

    // Checked before the password: a blocked attempt costs no hash
    const byIp = await this.limiter.attempt(
      ipKey('sign-in', req.ip),
      SIGN_IN_PER_IP,
    );
    if (!byIp.allowed) {
      return this.tooMany(res, 'sign-in:ip', byIp.retryAfterSeconds, again);
    }
    // Reserves a slot for this email; a successful sign-in gives it back, so only
    // failures count. Unknown emails are limited the same way, revealing nothing.
    const byEmail = await this.limiter.attempt(
      emailKey('sign-in', email),
      SIGN_IN_PER_EMAIL,
    );
    if (!byEmail.allowed) {
      return this.tooMany(
        res,
        'sign-in:email',
        byEmail.retryAfterSeconds,
        again,
      );
    }

    const accountId = await this.accounts.signIn(email, password);
    if (!accountId) {
      // One message for an unknown email and a wrong password
      return renderPage(
        res,
        400,
        again("That email and password don't match."),
      );
    }
    await byEmail.release();

    // The password is right but has appeared in a breach since it was chosen (WP-23).
    // Whoever typed it may have it from a leak, so getting in now takes the inbox: a
    // reset link, not a new password chosen here (that would hand an attacker the
    // account). The page says why, so the owner changes it elsewhere too.
    if (await this.passwords.isBreached(password)) {
      const byResetEmail = await this.limiter.attempt(
        emailKey('reset', email),
        RESET_PER_EMAIL,
      );
      if (byResetEmail.allowed) await this.resets.request(email);
      this.logger.warn(
        { accountId, resetEmailSent: byResetEmail.allowed },
        'Sign-in stopped: breached password',
      );
      return renderPage(
        res,
        403,
        <BreachedPasswordPage uid={uid} email={email} />,
      );
    }
    // The password proved this account is theirs: connect the Google identity that
    // brought them here (a no-op for an ordinary sign-in)
    await this.federation.linkAfterSignIn(uid, accountId);
    await this.finish(req, res, { login: { accountId } });
  }

  @Get(':uid/register')
  async showRegister(@Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    renderPage(res, 200, <RegisterPage uid={details.uid} />);
  }

  @Post(':uid/register')
  async register(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }

    const form = registerForm.safeParse(body);
    if (!form.success) {
      return renderPage(
        res,
        400,
        <RegisterPage uid={uid} error="Enter a valid email and a password." />,
      );
    }
    const { email, displayName, password } = form.data;
    const page = (error: string) => (
      <RegisterPage
        uid={uid}
        email={email}
        displayName={displayName}
        error={error}
      />
    );
    const again = (error: string) => renderPage(res, 400, page(error));

    // Before the breach check and the hash, which cost time and memory
    const byIp = await this.limiter.attempt(
      ipKey('register', req.ip),
      REGISTER_PER_IP,
    );
    if (!byIp.allowed) {
      return this.tooMany(res, 'register:ip', byIp.retryAfterSeconds, page);
    }

    const problem = await this.passwords.check(password);
    if (problem) return again(PASSWORD_PROBLEMS[problem]);

    // Over the limit, nothing is sent, but the page is the same: it says nothing about
    // the address, only the inbox does
    const byEmail = await this.limiter.attempt(
      emailKey('register', email),
      REGISTER_PER_EMAIL,
    );
    if (byEmail.allowed) {
      await this.registrations.start({ email, password, displayName });
    } else {
      this.logger.warn(
        {
          limit: 'register:email',
          retryAfterSeconds: byEmail.retryAfterSeconds,
        },
        'Rate limit reached, no email sent',
      );
    }
    // New address or taken, the same page: the email tells the owner which it was
    renderPage(
      res,
      200,
      <CheckEmailPage uid={uid} email={email} purpose="register" />,
    );
  }

  @Get(':uid/forgot')
  async showForgot(@Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    renderPage(res, 200, <ForgotPasswordPage uid={details.uid} />);
  }

  @Post(':uid/forgot')
  async forgot(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }

    const form = forgotForm.safeParse(body);
    if (!form.success) {
      return renderPage(
        res,
        400,
        <ForgotPasswordPage uid={uid} error="Enter a valid email." />,
      );
    }
    const { email } = form.data;
    const page = (error: string) => (
      <ForgotPasswordPage uid={uid} email={email} error={error} />
    );

    const byIp = await this.limiter.attempt(
      ipKey('reset', req.ip),
      RESET_PER_IP,
    );
    if (!byIp.allowed) {
      return this.tooMany(res, 'reset:ip', byIp.retryAfterSeconds, page);
    }
    // Same as registration: over the limit, the same page and no email
    const byEmail = await this.limiter.attempt(
      emailKey('reset', email),
      RESET_PER_EMAIL,
    );
    if (byEmail.allowed) {
      await this.resets.request(email);
    } else {
      this.logger.warn(
        { limit: 'reset:email', retryAfterSeconds: byEmail.retryAfterSeconds },
        'Rate limit reached, no email sent',
      );
    }
    renderPage(
      res,
      200,
      <CheckEmailPage uid={uid} email={email} purpose="reset" />,
    );
  }

  @Get(':uid/abort')
  async abort(@Req() req: Request, @Res() res: Response) {
    if (!(await this.details(req, res))) return;
    await this.finish(req, res, {
      error: 'access_denied',
      error_description: 'The user cancelled the sign-in',
    });
  }

  /**
   * Every client is ours (first-party), so consent is given without a screen: the
   * grant gets whatever the request is missing. A third-party client would get a
   * consent page here instead.
   */
  private async consent(
    req: Request,
    res: Response,
    { prompt: { details }, params, session }: InteractionDetails,
  ) {
    const grant = details.grantId
      ? await this.provider.Grant.find(details.grantId as string)
      : new this.provider.Grant({
          accountId: session?.accountId,
          clientId: params.client_id as string,
        });
    if (!grant) {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    const missingScope = details.missingOIDCScope as string[] | undefined;
    if (missingScope) grant.addOIDCScope(missingScope.join(' '));
    const missingClaims = details.missingOIDCClaims as string[] | undefined;
    if (missingClaims) grant.addOIDCClaims(missingClaims);
    const missingResourceScopes = details.missingResourceScopes as
      Record<string, string[]> | undefined;
    for (const [resource, scopes] of Object.entries(
      missingResourceScopes ?? {},
    )) {
      grant.addResourceScope(resource, scopes.join(' '));
    }
    const grantId = await grant.save();
    // Merged with the sign-in result submitted earlier in this interaction
    await this.finish(req, res, { consent: { grantId } }, true);
  }

  /** 429 with the form again; the log names the limit, never the email */
  private tooMany(
    res: Response,
    limit: string,
    retryAfterSeconds: number,
    page: (error: string) => ReactElement,
  ) {
    this.logger.warn({ limit, retryAfterSeconds }, 'Rate limit reached');
    const minutes = Math.ceil(retryAfterSeconds / 60);
    res.set('Retry-After', String(retryAfterSeconds));
    renderPage(
      res,
      429,
      page(
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      ),
    );
  }

  /** The interaction for this browser, or undefined after rendering an error page */
  private async details(req: Request, res: Response) {
    try {
      return await this.provider.interactionDetails(req, res);
    } catch {
      // Expired, finished, or the interaction cookie is missing (another browser)
      renderPage(res, 400, <ErrorPage message={EXPIRED} />);
      return undefined;
    }
  }

  private finish(
    req: Request,
    res: Response,
    result: InteractionResults,
    mergeWithLastSubmission = false,
  ) {
    return this.provider.interactionFinished(req, res, result, {
      mergeWithLastSubmission,
    });
  }
}

type InteractionDetails = Awaited<ReturnType<Provider['interactionDetails']>>;
