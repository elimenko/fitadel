# ADR-0007: Use Prisma for database access and migrations

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The catalog service is the first service with a database
([ADR-0005](0005-postgresql-primary-database.md)). It needs type-safe queries from
TypeScript and versioned schema migrations that replay identically on developer
machines, in CI and on AWS. The tool chosen here becomes the default for later services.

The catalog schema relies on PostgreSQL-specific features:

- `CHECK` constraints
- partial unique indexes
- a generated search column
- a custom `IMMUTABLE` normalization function
- trigram GIN indexes
- database-generated UUIDv7 keys

Project-wide, learning widely used backend tools is an explicit goal alongside building
the product.

## Considered options

1. **Prisma** (schema DSL, generated client, Prisma Migrate). Pros: the most widely used
   TypeScript ORM; declarative schema with a generated typed client; migration workflow
   with drift detection; TypedSQL for typed raw queries. Cons: `CHECK` constraints and
   custom functions must be hand-written into migrations; partial indexes are a preview
   feature; generated code and install scripts; an abstraction between the code and the
   SQL; Prisma 8 is in release-candidate stage, so a major upgrade is near.
2. **Drizzle** (TypeScript schema, SQL-shaped query builder, Drizzle Kit). Pros: supports
   checks, partial indexes and generated columns; no code generation. Cons: version 1.0
   is in release-candidate stage and changes the migration format.
3. **Kysely with hand-written SQL migrations.** Pros: every PostgreSQL feature is
   first-class; no install scripts; queries map one-to-one to SQL. Cons: the most manual
   work; no schema-level modelling; less widely known.
4. **TypeORM** (decorator entities). Pros: NestJS's traditional default. Cons: weaker
   type safety; less transparent generated SQL.

## Decision

We will use **Prisma 7** for database access and migrations. It covers most of the
schema declaratively, the gaps can be filled with customized migrations and TypedSQL,
and learning Prisma, the most widely used TypeScript ORM, is a deliberate goal.

## Consequences

**Positive**

- One declarative schema and a generated typed client per service.
- Prisma Migrate detects drift between migrations and the database.
- Experience with the ORM most common in TypeScript backends.

**Negative**

- `schema.prisma` is not the whole truth. `CHECK` constraints and functions live only
  in migration SQL.
- Preview features (partial indexes, extensions) may change between releases.
- Prisma's build scripts must be approved in pnpm, and the generated client is an extra
  build step.

**Follow-ups**

- Step 3 verifies that later migrations leave hand-written objects alone, and checks
  generated-column support, before the schema depends on them.
- Pin Prisma 7. Upgrade to Prisma 8 once it is stable.
- Run migrations as a separate deploy step, not at application startup.
