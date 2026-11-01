import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EmailMessage } from '../email/mailer';

/**
 * The emails identity sends, each as plain text and HTML. Email clients ignore most
 * CSS and run no scripts, so the HTML is plain markup; React escapes every value.
 */

export const REGISTRATION_LINK_HOURS = 24;

function html(children: ReactNode): string {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
        {children}
      </body>
    </html>,
  )}`;
}

export function verificationEmail(input: {
  to: string;
  displayName?: string;
  link: string;
}): EmailMessage {
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const expires = `The link works once and expires in ${REGISTRATION_LINK_HOURS} hours.`;
  const ignore =
    "If you didn't create a Fitadel account, ignore this email: no account is created without the link.";
  return {
    to: input.to,
    subject: 'Confirm your email for Fitadel',
    text: [
      greeting,
      'Open this link to confirm your email and finish creating your Fitadel account:',
      input.link,
      expires,
      ignore,
    ].join('\n\n'),
    html: html(
      <>
        <p>{greeting}</p>
        <p>Confirm your email to finish creating your Fitadel account:</p>
        <p>
          <a href={input.link}>Confirm email</a>
        </p>
        <p>{expires}</p>
        <p>{ignore}</p>
      </>,
    ),
  };
}

/**
 * Sent instead of a verification email when the address already has an account, so
 * the registration page looks the same either way and reveals nothing.
 */
export function alreadyRegisteredEmail(input: { to: string }): EmailMessage {
  const lines = [
    'Someone, hopefully you, tried to create a Fitadel account with this email address. It already has an account, so nothing changed.',
    'If it was you, sign in from the app with your password.',
    "If it wasn't you, you can ignore this email. Your account is safe.",
  ];
  return {
    to: input.to,
    subject: 'You already have a Fitadel account',
    text: ['Hi,', ...lines].join('\n\n'),
    html: html(
      <>
        <p>Hi,</p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </>,
    ),
  };
}

export const RESET_LINK_MINUTES = 30;

export function passwordResetEmail(input: {
  to: string;
  link: string;
}): EmailMessage {
  const expires = `The link works once and expires in ${RESET_LINK_MINUTES} minutes.`;
  const ignore =
    "If you didn't ask for this, ignore this email: your password stays as it is.";
  return {
    to: input.to,
    subject: 'Reset your Fitadel password',
    text: [
      'Hi,',
      'Open this link to choose a new password for your Fitadel account:',
      input.link,
      expires,
      ignore,
    ].join('\n\n'),
    html: html(
      <>
        <p>Hi,</p>
        <p>Choose a new password for your Fitadel account:</p>
        <p>
          <a href={input.link}>Reset password</a>
        </p>
        <p>{expires}</p>
        <p>{ignore}</p>
      </>,
    ),
  };
}

/**
 * Sent instead of a reset link when the address has no account, so the "forgot
 * password" page looks the same and does the same work either way.
 */
export function noAccountEmail(input: { to: string }): EmailMessage {
  const lines = [
    'Someone, hopefully you, asked to reset the Fitadel password for this email address, but there is no Fitadel account for it.',
    'If it was you, you may have registered with another address, or you can create an account from the app.',
    "If it wasn't you, you can ignore this email.",
  ];
  return {
    to: input.to,
    subject: 'No Fitadel account for this address',
    text: ['Hi,', ...lines].join('\n\n'),
    html: html(
      <>
        <p>Hi,</p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </>,
    ),
  };
}

/** After a reset: if it wasn't the owner, this is how they find out */
export function passwordChangedEmail(input: { to: string }): EmailMessage {
  const lines = [
    'The password for your Fitadel account was just changed, and every device was signed out.',
    "If it was you, there's nothing to do.",
    "If it wasn't you, someone can read your email: secure your email account first, then reset your Fitadel password from the sign-in page.",
  ];
  return {
    to: input.to,
    subject: 'Your Fitadel password was changed',
    text: ['Hi,', ...lines].join('\n\n'),
    html: html(
      <>
        <p>Hi,</p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </>,
    ),
  };
}
