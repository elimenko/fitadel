import { type INestApplication, VersioningType } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * HTTP settings every entry point applies (main.ts, tests, the openapi command), so they
 * all serve the same API.
 */
export function configureHttp(app: INestApplication): void {
  // Versioned paths, e.g. /v1/foods. Controllers without a version (health) stay as they are.
  app.enableVersioning({ type: VersioningType.URI });
}

/** The OpenAPI description, generated from the controllers and their zod schemas */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Fitadel catalog API')
    .setDescription(
      'Foods with nutrition values, barcode lookup and search. Errors use RFC 9457 ' +
        'problem details (application/problem+json).',
    )
    .setVersion('1')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

/** Swagger UI at /docs and the raw document at /docs/openapi.json */
export function serveApiDocs(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
