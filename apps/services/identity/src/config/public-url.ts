/**
 * Absolute links to this service's own pages, for emails. Derived from the issuer,
 * which is the service's public URL (the gateway's, behind one) plus `/oidc`, so there
 * is no second URL to keep in sync.
 */
export class PublicUrl {
  private readonly base: URL;

  constructor(issuer: string) {
    // http://host/prefix/oidc → http://host/prefix/
    this.base = new URL('../', issuer.endsWith('/') ? issuer : `${issuer}/`);
  }

  /**
   * Values go in the fragment (`#name=value`), not the query: browsers never send it,
   * so a secret in it reaches no server, proxy or log on the way.
   */
  link(path: string, fragment: Record<string, string> = {}): string {
    const url = new URL(path, this.base);
    url.hash = new URLSearchParams(fragment).toString();
    return url.href;
  }
}
