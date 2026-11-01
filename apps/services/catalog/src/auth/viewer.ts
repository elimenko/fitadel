import type { Viewer } from '@fitadel/shared-auth';

// Established by AccessTokenGuard from the request's access token (AppModule)
export { CurrentViewer, Public, type Viewer } from '@fitadel/shared-auth';

/** May create public (community) foods. Identity grants the role (account_role). */
export const isContributor = (viewer: Viewer | null): boolean =>
  viewer?.roles.has('contributor') ?? false;
