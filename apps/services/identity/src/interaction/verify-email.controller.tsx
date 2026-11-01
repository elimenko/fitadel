import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RegistrationService } from '../account/registration.service';
import { ConfirmEmailPage, NoticePage } from './pages';
import { renderPage } from './render';

/** 32 random bytes in base64url; anything else can't be one of our tokens */
const token = z.string().regex(/^[\w-]{43}$/);

/**
 * The link in the verification email. It works in any browser (often another device),
 * so unlike the sign-in pages it needs no interaction cookie: the token is the proof.
 * Logs and traces record the URL without it (`token` is redacted in both).
 */
@Controller('verify-email')
export class VerifyEmailController {
  constructor(private readonly registrations: RegistrationService) {}

  @Get()
  async show(@Res() res: Response, @Query('token') query: unknown) {
    const parsed = token.safeParse(query);
    if (!parsed.success || !(await this.registrations.isValid(parsed.data))) {
      return expired(res);
    }
    renderPage(res, 200, <ConfirmEmailPage token={parsed.data} />);
  }

  @Post()
  async confirm(@Res() res: Response, @Body() body: unknown) {
    const parsed = z.object({ token }).safeParse(body);
    if (!parsed.success) return expired(res);

    const result = await this.registrations.confirm(parsed.data.token);
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
