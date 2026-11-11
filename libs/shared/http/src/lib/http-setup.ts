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

/** What a service says about its API in the OpenAPI document */
export interface ApiInfo {
  title: string;
  /** Followed by a sentence about the error format */
  description: string;
}

/** The OpenAPI description, generated from the controllers and their zod schemas */
export function createOpenApiDocument(
  app: INestApplication,
  info: ApiInfo,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(info.title)
    .setDescription(
      `${info.description} Errors use RFC 9457 problem details ` +
        '(application/problem+json).',
    )
    .setVersion('1')
    // Access tokens from the identity service (Authorization: Bearer <token>)
    .addBearerAuth()
    // 3.1 uses standard JSON Schema, which is what zod emits (e.g. type: ["number", "null"])
    .setOpenAPIVersion('3.1.0')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

/** Swagger UI at /docs and the raw document at /docs/openapi.json */
export function serveApiDocs(app: INestApplication, info: ApiInfo): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app, info), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
