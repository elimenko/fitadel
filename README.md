# Fitadel

A calorie and nutrition tracker for web and Android: set a goal, log food by search,
barcode or AI-assisted entry, and track your daily budget.

> **Status:** early development. See the [roadmap](docs/roadmap.md).

## Why this architecture

Fitadel is also an architecture exercise. It deliberately uses a production-grade,
distributed stack that a personal tracker wouldn't strictly need: microservices, gRPC,
Kafka, Module Federation, Kubernetes. The goal is to practice and demonstrate how such
systems are built, tested and operated. Decisions and their trade-offs are recorded as
ADRs in `docs/adr`.

## Planned stack

- **Monorepo:** Nx, pnpm, TypeScript
- **Web:** React micro-frontends with Module Federation (Rspack)
- **Mobile:** React Native (Android first)
- **Backend:** NestJS microservices, gRPC (sync), Kafka (async)
- **Data:** PostgreSQL, MongoDB, Redis
- **Identity:** own OpenID Connect provider
- **Infrastructure:** AWS, Terraform, Kubernetes, GitHub Actions
- **Observability:** OpenTelemetry, Grafana, Prometheus, Loki, Tempo

## Getting started

Prerequisites: Node.js 24 (see `.nvmrc`) and pnpm 12 (`corepack enable` picks up the
pinned version).

```sh
pnpm install
pnpm nx graph   # explore the project graph
```

## Repository layout

```
apps/
  web/        web micro-frontends
  mobile/     React Native app
  services/   backend services
libs/
  <domain>/   libraries grouped by domain (food, diary, ...), plus shared/
```

## License

[MIT](LICENSE)
