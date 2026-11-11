import type { INestApplication } from '@nestjs/common';

/**
 * Test helpers, imported from '@fitadel/shared-auth/testing'. Not for production code.
 */

/**
 * Calls every route of a listening app without a token and returns the ones that don't
 * answer 401, e.g. ['GET /health/live']. A service's integration test compares them with
 * its routes marked @Public(), so a new endpoint is covered without listing it.
 */
export async function routesOpenWithoutToken(
  app: INestApplication,
): Promise<string[]> {
  const routes = registeredRoutes(app);
  if (routes.length === 0) throw new Error('The app has no routes');
  const open: string[] = [];
  for (const { method, path } of routes) {
    // Guards run before validation, so any value reaches the token check
    const url = path.replace(/:\w+/g, '0');
    const response = await fetch(`${await app.getUrl()}${url}`, { method });
    if (response.status !== 401) open.push(`${method} ${path}`);
  }
  return open.sort();
}

/** Every route Nest registered with Express */
function registeredRoutes(app: INestApplication) {
  const express = app.getHttpAdapter().getInstance() as {
    router: {
      stack: { route?: { path: string; methods: Record<string, boolean> } }[];
    };
  };
  return express.router.stack.flatMap(({ route }) =>
    // Wildcard paths are middleware (request logging) mounted for every method
    route && !route.path.includes('*')
      ? Object.keys(route.methods).map((method) => ({
          method: method.toUpperCase(),
          path: route.path,
        }))
      : [],
  );
}
