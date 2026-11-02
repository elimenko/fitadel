import { Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import {
  FEDERATION_TTL_MS,
  FederationService,
} from '../federation/federation.service';
import { OIDC_PROVIDER } from '../oidc/oidc.module';
import { ErrorPage, SignInPage } from './pages';
import { renderPage } from './render';

/** Binds Google's callback to the browser that started the attempt */
const STATE_COOKIE = 'fitadel_google_state';
const CALLBACK_PATH = '/interaction/google/callback';

const EXPIRED =
  'This sign-in has expired or was opened in another browser. Go back to the app and start again.';

/**
 * "Continue with Google" on the sign-in page. Google redirects back to one fixed URL,
 * which the interaction cookie (scoped to /interaction/<uid>) doesn't reach, so the
 * callback stores what it found and sends the browser on to /interaction/<uid>/google,
 * where the interaction finishes as with a password.
 */
@Controller('interaction')
export class GoogleController {
  constructor(
    @Inject(OIDC_PROVIDER) private readonly provider: Provider,
    private readonly federation: FederationService,
  ) {}

  @Post(':uid/google')
  async start(@Req() req: Request, @Res() res: Response) {
    const details = await this.details(req, res);
    if (!details) return;
    if (details.prompt.name !== 'login' || !this.federation.googleEnabled) {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    const { url, state } = await this.federation.startGoogle(details.uid);
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      // Lax: sent on Google's top-level redirect back, not on cross-site subrequests
      sameSite: 'lax',
      secure: this.federation.googleRedirectUri.startsWith('https:'),
      path: CALLBACK_PATH,
      maxAge: FEDERATION_TTL_MS,
    });
    res.redirect(303, url.href);
  }

  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    if (!this.federation.googleEnabled) {
      return renderPage(res, 404, <ErrorPage message={EXPIRED} />);
    }
    const browserState = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: CALLBACK_PATH });
    // The registered redirect URI plus Google's parameters: the URL this request has
    // behind the gateway isn't the one Google redirected to
    const callbackUrl = new URL(this.federation.googleRedirectUri);
    callbackUrl.search = new URL(req.originalUrl, callbackUrl).search;

    const uid = await this.federation.finishGoogle(callbackUrl, browserState);
    if (!uid) return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    res.redirect(303, `/interaction/${encodeURIComponent(uid)}/google`);
  }

  @Get(':uid/google')
  async done(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    const result = await this.federation.resultFor(uid);
    if (!result || details.prompt.name !== 'login') {
      return renderPage(res, 400, <ErrorPage message={EXPIRED} />);
    }
    switch (result.outcome) {
      case 'signed_in':
        return this.provider.interactionFinished(req, res, {
          login: { accountId: result.accountId },
        });
      case 'link_required':
        return renderPage(
          res,
          200,
          <SignInPage uid={uid} email={result.email} linkingGoogle />,
        );
      case 'email_unverified':
        return renderPage(
          res,
          400,
          <SignInPage
            uid={uid}
            google
            error="Google hasn't confirmed that email address, so it can't sign you in. Use your email and password instead."
          />,
        );
      case 'failed':
        return renderPage(
          res,
          400,
          <SignInPage
            uid={uid}
            google
            error="Signing in with Google didn't work. Try again, or use your email and password."
          />,
        );
    }
  }

  /** The interaction for this browser, or undefined after rendering an error page */
  private async details(req: Request, res: Response) {
    try {
      return await this.provider.interactionDetails(req, res);
    } catch {
      renderPage(res, 400, <ErrorPage message={EXPIRED} />);
      return undefined;
    }
  }
}

/** One cookie's value; Express doesn't parse cookies without a middleware */
function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
