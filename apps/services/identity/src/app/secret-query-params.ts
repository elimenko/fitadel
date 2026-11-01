/**
 * Query parameters that carry credentials: the token in an emailed link
 * (/verify-email?token=…). Anyone who can read logs or traces could use a token that
 * hasn't been used yet, so both record these as redacted. Kept free of imports:
 * instrumentation.ts loads it before anything else.
 */
export const SECRET_QUERY_PARAMS = ['token'];

const pattern = new RegExp(
  `([?&](?:${SECRET_QUERY_PARAMS.join('|')})=)[^&#]*`,
  'g',
);

export function redactUrl(url: string): string {
  return url.replace(pattern, '$1[redacted]');
}
