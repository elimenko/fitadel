import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Makes `req.ip` the client's address as reported by the last `hops` proxies: each one
 * appends the address it saw to X-Forwarded-For, so only the rightmost `hops` entries
 * come from proxies we run. Anything to their left is whatever the client sent.
 */
export function trustProxies(app: NestExpressApplication, hops: number): void {
  app.set('trust proxy', hops);
}
