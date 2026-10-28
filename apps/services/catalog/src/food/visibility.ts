import type { Viewer } from '../auth/viewer';

/**
 * Prisma filter: the foods a viewer may see. Public foods for everyone, plus the viewer's
 * own private ones. Anonymous viewers see public foods only.
 */
export function visibleTo(viewer: Viewer | null) {
  return {
    OR: [
      { visibility: 'public' as const },
      ...(viewer ? [{ ownerId: viewer.id }] : []),
    ],
  };
}
