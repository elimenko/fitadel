# shared-http

HTTP conventions shared by Fitadel's REST services:

- `ProblemDetailsFilter`: every error leaves as RFC 9457 problem details
  (`application/problem+json`); validation errors list each invalid field.
  `ProblemException` adds extension members, e.g. `existingFoodId`.
- `configureHttp`: URI versioning (`/v1/...`). Apply it in every entry point (`main.ts`,
  tests, the `openapi` command), so they all serve the same API.
- `createOpenApiDocument` and `serveApiDocs`: the OpenAPI 3.1 document from the
  controllers and their zod schemas, and Swagger UI at `/docs`.

```ts
// AppModule
providers: ([{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
  // main.ts
  configureHttp(app));
serveApiDocs(app, {
  title: 'Fitadel catalog API',
  description: 'Foods with …',
});
```

Run `pnpm nx test shared-http` for the unit tests.
