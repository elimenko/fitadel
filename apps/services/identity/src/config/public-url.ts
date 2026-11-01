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

  link(path: string, query: Record<string, string> = {}): string {
    const url = new URL(path, this.base);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    return url.href;
  }
}
