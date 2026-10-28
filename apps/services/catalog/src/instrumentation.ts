/**
 * OpenTelemetry setup. It must run before any instrumented module (http, express, pg,
 * pino) is loaded, because auto-instrumentation patches modules when they are first
 * require()d. main.ts imports this file first.
 *
 * Exporters, endpoint and service name come from the standard OTEL_* environment
 * variables (see .env.example), so the backend can change without code changes.
 */
import {
  ExpressInstrumentation,
  ExpressLayerType,
} from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';

// The SDK's own exports to the collector (OTLP over HTTP)
const collector = new URL(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
);

export const telemetry = new NodeSDK({
  instrumentations: [
    new HttpInstrumentation({
      // Health probes run every few seconds and would bury real traffic
      ignoreIncomingRequestHook: (request) =>
        request.url?.startsWith('/health/') ?? false,
      // Don't measure telemetry exports: their spans are suppressed, metrics are not
      ignoreOutgoingRequestHook: (request) =>
        request.hostname === collector.hostname &&
        String(request.port) === collector.port,
    }),
    // Spans for route handlers only, not for every middleware (body parsers, ...)
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
    }),
    new NestInstrumentation(),
    // Only trace queries inside a traced operation, e.g. not the readiness ping
    new PgInstrumentation({ requireParentSpan: true }),
    // Adds trace_id/span_id to log lines and sends logs over OTLP
    new PinoInstrumentation(),
    // fetch() is built on undici, which the http instrumentation doesn't see
    // (outgoing calls such as the Open Food Facts API)
    new UndiciInstrumentation(),
  ],
});

telemetry.start();
