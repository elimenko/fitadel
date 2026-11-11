# Diary service

Daily calorie goals and the food diary: what a user ate, per meal and day, against the
budget their goal sets. Goals and diary entries share this service, because a day's
view needs both ([ADR-0010](../../../docs/adr/0010-goals-and-diary-in-one-service.md)).
Built with NestJS and Prisma on PostgreSQL, like the catalog.

The features arrive in Phase 3 ([roadmap](../../../docs/roadmap.md)); so far the service
has its database, health checks and access-token checks.

## Running it

Prerequisites: the local infrastructure from the [root README](../../../README.md)
(`docker compose up -d`). On a data volume created before the diary existed, provision
its database once:
`docker compose exec postgres bash /docker-entrypoint-initdb.d/diary.sh`.

```sh
cp apps/services/diary/.env.example apps/services/diary/.env
pnpm nx run diary:prisma migrate deploy   # apply migrations
pnpm nx serve diary                       # http://localhost:3020/health/ready
```

| Target                       | What it does                                       |
| ---------------------------- | -------------------------------------------------- |
| `nx test diary`              | unit tests                                         |
| `nx run diary:integration`   | tests against a throwaway Postgres (needs Docker)  |
| `nx run diary:prisma <args>` | the Prisma CLI, as the migrator role               |
| `nx run diary:openapi`       | regenerate `openapi.json` (CI checks it's current) |

API docs: Swagger UI at http://localhost:3020/docs (not in production), the OpenAPI
description in [openapi.json](openapi.json). Errors use RFC 9457 problem details.

## Access

Clients call the diary through the gateway, at `http://localhost:8080/api/diary/`. Every
route needs an access token from identity, both at the gateway and in the service
([authentication](../../../docs/architecture/authentication.md)); only the health
checks are open, and only on the service's own port.

## Database roles

[tools/db/diary.psql](../../../tools/db/diary.psql) creates the `diary` database and
three roles:

| Role             | Used by                  | Can                                     |
| ---------------- | ------------------------ | --------------------------------------- |
| `diary_migrator` | `prisma migrate`         | own and change the schema               |
| `diary_app`      | the running service      | read and write rows, no schema changes  |
| `diary_reader`   | people, with SQL clients | read every table, in read-only sessions |

Passwords come from the root `.env` (`DIARY_*_PASSWORD`).
