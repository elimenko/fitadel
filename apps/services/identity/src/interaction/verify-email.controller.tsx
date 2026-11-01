import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RegistrationService } from '../account/registration.service';
import { ConfirmEmailPage, NoticePage } from './pages';
import { renderPage } from './render';
import { LINK_TOKEN_SCRIPT_HASH } from './scripts';

/** 32 random bytes in base64url; anything else can't be one of our tokens */
const confirmForm = z.object({ token: z.string().regex(/^[\w-]{43}$/) });

/**
 * The link in the verification email: /verify-email#token=…. It works in any browser
 * (often another device), so unlike the sign-in pages it needs no interaction cookie:
 * the token is the proof. The server only ever sees the token in the POST body.
 */
@Controller('verify-email')
export class VerifyEmailController {
  constructor(private readonly registrations: RegistrationService) {}

  @Get()
  show(@Res() res: Response) {
    renderPage(res, 200, <ConfirmEmailPage />, {
      scriptHash: LINK_TOKEN_SCRIPT_HASH,
    });
  }

  @Post()
  async confirm(@Res() res: Response, @Body() body: unknown) {
    const form = confirmForm.safeParse(body);
    if (!form.success) return expired(res);

    const result = await this.registrations.confirm(form.data.token);
    if (result.status === 'invalid') return expired(res);
    renderPage(
      res,
      200,
      <NoticePage
        title={
          result.status === 'confirmed'
            ? 'Email confirmed'
            : 'You already have an account'
        }
      >
        <p>
          {result.status === 'confirmed'
            ? 'Your Fitadel account is ready. '
            : 'This email already has a Fitadel account. '}
          Go back to the page where you registered and sign in, or sign in from
          the app.
        </p>
      </NoticePage>,
    );
  }
}

function expired(res: Response) {
  renderPage(
    res,
    400,
    <NoticePage title="This link doesn't work anymore">
      <p>
        It has expired or was already used. If your account isn't ready yet,
        register again to get a new link.
      </p>
    </NoticePage>,
  );
}
