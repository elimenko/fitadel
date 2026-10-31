import type { Response } from 'express';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STYLES_HASH } from './styles';

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${STYLES_HASH}`,
  "base-uri 'none'",
  // Nobody may frame the sign-in page (clickjacking)
  "frame-ancestors 'none'",
  // No form-action: Chrome applies it to the redirects after a form post too, and the
  // last redirect goes to the client's redirect_uri on another origin
].join('; ');

/** Sends a page as HTML; React escapes every value, so user input can't add markup. */
export function renderPage(res: Response, status: number, page: ReactElement) {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      // Pages carry the interaction id; nothing should keep or forward them
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(`<!doctype html>${renderToStaticMarkup(page)}`);
}
