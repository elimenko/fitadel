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
- **Data:** PostgreSQL, Redis
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

### Local infrastructure

Backing services run in Docker: PostgreSQL, and an observability stack
([grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm)) that receives
OpenTelemetry data. Prerequisite: Docker with Compose v2.

```sh
cp .env.example .env    # then adjust the values
docker compose up -d    # start, wait for "healthy" in docker compose ps
docker compose down     # stop; add -v to also delete the data volumes
```

Grafana runs at http://localhost:3001, with traces (Tempo), metrics (Prometheus)
and logs (Loki) from the services.

A fresh data volume provisions each service's database and roles on first start
([tools/db](tools/db)). For an existing volume, run a service's script once, e.g.
`docker compose exec postgres bash /docker-entrypoint-initdb.d/catalog.sh`.

### Running a service

```sh
cp apps/services/catalog/.env.example apps/services/catalog/.env
pnpm nx run catalog:prisma migrate deploy   # apply database migrations
pnpm nx serve catalog                       # http://localhost:3000/health/ready
pnpm nx run catalog:integration             # integration tests (needs Docker)
```

Each service documents itself, e.g. [the catalog](apps/services/catalog/README.md)
(database roles, the Open Food Facts import).

## Repository layout

```
apps/
  web/        web micro-frontends
  mobile/     React Native app
  services/   backend services
libs/
  <domain>/   libraries grouped by domain (food, diary, ...), plus shared/
```

## Data

Food data comes from [Open Food Facts](https://world.openfoodfacts.org), available
under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
Import a dump into the catalog with
`pnpm nx run catalog:import-off <openfoodfacts-products.jsonl.gz>`
([download](https://world.openfoodfacts.org/data)).

## License

[MIT](LICENSE)
