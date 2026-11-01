import { createHash } from 'node:crypto';

/**
 * The confirmation page's only script. Emailed links carry their token in the fragment
 * (`#token=…`), which browsers never send to a server: no access log, trace, gateway
 * or load balancer along the way can record it. This copies it into the form, enables
 * the button, and removes it from the address bar and the history.
 */
export const CONFIRM_EMAIL_SCRIPT = `
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) {
  document.getElementById('token').value = token;
  document.getElementById('confirm').disabled = false;
  history.replaceState(null, '', location.pathname);
}
`;

/** Allowed by its hash in this page's Content Security Policy; nothing else may run */
export const CONFIRM_EMAIL_SCRIPT_HASH = `'sha256-${createHash('sha256').update(CONFIRM_EMAIL_SCRIPT).digest('base64')}'`;
