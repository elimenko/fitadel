import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PasswordResetService } from '../account/password-reset.service';
import {
  PASSWORD_MAX_LENGTH,
  PasswordPolicy,
} from '../account/password-policy';
import { PASSWORD_PROBLEMS } from './messages';
import { NoticePage, ResetPasswordPage } from './pages';
import { renderPage } from './render';
import { LINK_TOKEN_SCRIPT_HASH } from './scripts';

const resetForm = z.object({
  /** 32 random bytes in base64url; anything else can't be one of our tokens */
  token: z.string().regex(/^[\w-]{43}$/),
  // Length rules are PasswordPolicy's; this only bounds the input
  password: z.string().max(PASSWORD_MAX_LENGTH * 4),
});

/**
 * The link in the reset email: /reset-password#token=…. Like the verification link it
 * works in any browser, and the server only sees the token in the POST body.
 */
@Controller('reset-password')
export class ResetPasswordController {
  constructor(
    private readonly resets: PasswordResetService,
    private readonly passwords: PasswordPolicy,
  ) {}

  @Get()
  show(@Res() res: Response) {
    renderPage(res, 200, <ResetPasswordPage />, {
      scriptHash: LINK_TOKEN_SCRIPT_HASH,
    });
  }

  @Post()
  async reset(@Res() res: Response, @Body() body: unknown) {
    const form = resetForm.safeParse(body);
    if (!form.success) return expired(res);
    const { token, password } = form.data;

    // Before the breach check and the hash: a bad token costs one query
    if (!(await this.resets.isValid(token))) return expired(res);

    const problem = await this.passwords.check(password);
    if (problem) {
      // The token goes back in the page body, so the user can try another password
      return renderPage(
        res,
        400,
        <ResetPasswordPage token={token} error={PASSWORD_PROBLEMS[problem]} />,
        { scriptHash: LINK_TOKEN_SCRIPT_HASH },
      );
    }

    const result = await this.resets.reset(token, password);
    if (result.status === 'invalid') return expired(res);
    renderPage(
      res,
      200,
      <NoticePage title="Password changed">
        <p>
          Every device was signed out. Go back to the sign-in page, or open the
          app, and sign in with your new password.
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
        It has expired or was already used. Ask for a new one with "Forgot your
        password?" on the sign-in page.
      </p>
    </NoticePage>,
  );
}
