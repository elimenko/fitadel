# Diary service

Daily calorie goals and the food diary: what a user ate, per meal and day, against the
budget their goal sets. Goals and diary entries share this service, because a day's
view needs both ([ADR-0010](../../../docs/adr/0010-goals-and-diary-in-one-service.md)).
Built with NestJS and Prisma on PostgreSQL, like the catalog.

The features arrive in Phase 3 ([roadmap](../../../docs/roadmap.md)); so far the service
has goals and diary entries (foods from the catalog, or manual), plus its database,
health checks and access-token checks.

## Goals

A goal sets the daily calorie budget and macro targets. It is in effect **from a date**
until the user's next goal starts, so changing the goal never changes the budget of
earlier days. The goal in effect on a day is the latest one that started on or before
it.

| Setting           | Example                | Notes                                            |
| ----------------- | ---------------------- | ------------------------------------------------ |
| `maintenanceKcal` | 2600                   | entered by the user (calculating it comes later) |
| `adjustment`      | `-20` % or `-500` kcal | negative for a deficit; none when omitted        |
| `proteinG`        | 150                    | the user's target                                |
| `fatG`            | 60                     | the user's target                                |
| `fiberG`          | 30                     | the user's target                                |

The service stores the settings and computes the targets when it reads them: the budget
is maintenance plus the adjustment, and carbs get what is left after protein (4 kcal/g)
and fat (9 kcal/g), rounded to whole kcal and grams. Settings where protein and fat
alone exceed the budget are rejected with `422`.

| Route                              | Does                                             |
| ---------------------------------- | ------------------------------------------------ |
| `PUT /v1/goals/{effectiveFrom}`    | create or replace the goal starting on that date |
| `GET /v1/goals`                    | all of the user's goals, latest first            |
| `GET /v1/goals/{effectiveFrom}`    | the goal starting on that date                   |
| `GET /v1/goals/effective?date=…`   | the goal in effect on a date, or `404`           |
| `DELETE /v1/goals/{effectiveFrom}` | delete it; the previous goal applies again       |

Dates are calendar dates (`YYYY-MM-DD`) chosen by the client, which knows the user's
"today". The service never converts them to or from a time zone.

## Diary

An entry is something the user ate on a day, in one of four meals (breakfast, lunch,
dinner, snack). It stores its values for the whole entry, and an unknown macro is
`null`, not `0`. There are two kinds:

- **food** (`{ kind: 'food', meal, foodId, amount }`): a food from the catalog and the
  amount eaten, in the food's unit (g or ml). The diary asks the catalog for the food
  on the user's behalf and keeps a copy of it with the entry: its name (in the user's
  `Accept-Language`), brand and values per 100. Later changes in the catalog never
  rewrite the diary; a new amount is computed from the copy, without the catalog.
- **manual** (`{ kind: 'manual', meal, kcal, … }`): typed in by the user. Only `kcal`
  is required; the name and macros are optional.

| Route                          | Does                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `GET /v1/days/{date}`          | the day: entries by meal, totals, targets and remaining                      |
| `POST /v1/days/{date}/entries` | log a food or a manual entry                                                 |
| `GET /v1/entries/{id}`         | one entry                                                                    |
| `PUT /v1/entries/{id}`         | replace it; a new `date` or `meal` moves it; a new `foodId` copies that food |
| `DELETE /v1/entries/{id}`      | delete it                                                                    |

The day view adds up the day's entries when it is read. `remaining` is the targets of
the goal in effect minus the totals, negative when over, and `null` without a goal.
Unknown macros count as nothing, and `incomplete` names them, so the app can show
"at least 120 g" instead of an exact number.

### The catalog call

Logging a food calls the catalog over gRPC (`CATALOG_GRPC_URL`, ADR-0011), with the
user's access token, so private foods stay private. The user waits at most 1 s, one
retry included. Reading the diary never calls the catalog.

| Status | When                                                     |
| ------ | -------------------------------------------------------- |
| `422`  | no such food, or someone else's private food             |
| `503`  | the catalog is unavailable; try again shortly            |
| `504`  | the catalog didn't answer within the deadline; try again |
| `502`  | the catalog failed otherwise                             |

The entry isn't logged in any of these cases. Manual entries need no catalog.

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
