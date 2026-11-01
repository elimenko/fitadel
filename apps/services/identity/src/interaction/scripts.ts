import { createHash } from 'node:crypto';

/**
 * The only script, on the pages emailed links open (email confirmation, password
 * reset). Emailed links carry their token in the fragment
 * (`#token=…`), which browsers never send to a server: no access log, trace, gateway
 * or load balancer along the way can record it. This copies it into the form, enables
 * the button, and removes it from the address bar and the history.
 */
export const LINK_TOKEN_SCRIPT = `
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) {
  document.getElementById('token').value = token;
  document.getElementById('submit').disabled = false;
  history.replaceState(null, '', location.pathname);
}
`;

/** Allowed by its hash in these pages' Content Security Policy; nothing else may run */
export const LINK_TOKEN_SCRIPT_HASH = `'sha256-${createHash('sha256').update(LINK_TOKEN_SCRIPT).digest('base64')}'`;
