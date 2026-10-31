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
import { z } from 'zod';
import { AccountService } from '../account/account.service';
import { OIDC_PROVIDER } from '../oidc/oidc.module';
import { ErrorPage, SignInPage } from './pages';
import { renderPage } from './render';

/** Upper bound for the work one request can cause: argon2 reads the whole input */
const PASSWORD_MAX_LENGTH = 256;

const signInForm = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
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
  ) {}

  @Get(':uid')
  async show(@Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res);
    if (!details) return;
    const { uid, prompt } = details;

    if (prompt.name === 'login') {
      return renderPage(res, 200, <SignInPage uid={uid} />);
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

    const form = signInForm.safeParse(body);
    if (!form.success) {
      return renderPage(
        res,
        400,
        <SignInPage uid={uid} error="Enter your email and password." />,
      );
    }
    const { email, password } = form.data;
    const accountId = await this.accounts.signIn(email, password);
    if (!accountId) {
      // One message for an unknown email and a wrong password
      return renderPage(
        res,
        400,
        <SignInPage
          uid={uid}
          email={email}
          error="That email and password don't match."
        />,
      );
    }
    await this.finish(req, res, { login: { accountId } });
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
