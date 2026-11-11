# shared-telemetry

OpenTelemetry for NestJS services: traces, metrics and logs over OTLP, configured by the
standard `OTEL_*` environment variables (see a service's `.env.example`).

Importing the package starts the SDK. Auto-instrumentation patches modules (http,
express, pg, pino) when they are first loaded, so it must be the first import in
`main.ts`:

```ts
// Must be the first import: it instruments modules as they load
import { shutdownTelemetry } from '@fitadel/shared-telemetry';
```

On shutdown, call `shutdownTelemetry()` after closing the app, so the shutdown itself is
still traced and logged. It never throws: an unreachable collector must not turn a clean
exit into a failure.

The instrumentation libraries are loaded from `node_modules` at runtime, so each service
lists them in its own `package.json` as well (webpack keeps them external).
