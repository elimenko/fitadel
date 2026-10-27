# ADR-0005: Use PostgreSQL as the primary database

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Fitadel's services need durable storage for data of different shapes:

- identity: users, credentials, OAuth clients, consents and refresh tokens, which are
  relational, constrained and security-critical;
- goals and the food diary: relational, aggregated into daily and weekly totals, and
  expected to be exactly right;
- the food catalog: product records imported from Open Food Facts and USDA FoodData
  Central, with irregular, optional nutrient fields and multilingual names, read far
  more often than written.

Each service owns its data, so each could in principle use a different store. Every
additional database engine, however, has to be run locally and in AWS, backed up,
monitored, upgraded and understood. The planned stack originally listed MongoDB next to
PostgreSQL. The first service, the food catalog, is about to be built, so the default
store has to be settled now. Ephemeral data (caches, short-lived authentication state)
doesn't need a durable store and is out of scope.

## Considered options

1. **PostgreSQL for all services.** Pros: transactions, constraints and SQL aggregations
   for the relational data; JSONB for irregular, document-shaped data; built-in
   full-text search; one engine to operate; mature managed offerings (Amazon RDS,
   Aurora). Cons: document-shaped data needs deliberate JSONB modelling; scaling writes
   horizontally is harder than with a document store, which is irrelevant at Fitadel's
   scale.
2. **PostgreSQL, plus MongoDB for document-shaped data** (food catalog, later AI
   conversations). Pros: catalog records map naturally onto documents (Open Food Facts
   itself runs on MongoDB); practice with a document store. Cons: a second engine to run,
   back up and monitor; no transactions spanning both stores; the document-shaped needs
   are covered by JSONB, so the main argument left is learning.
3. **MongoDB for all services.** Pros: one engine; flexible schema. Cons: a poor fit for
   most of the data, which is relational and transactional (identity, diary);
   constraints and aggregations are weaker than in SQL.

## Decision

We will use **PostgreSQL** as the primary database for every service, without a
document database, because one engine covers both the relational and the document-shaped
data at Fitadel's scale, and a second engine would add operational cost without a use
case that requires it.

## Consequences

**Positive**

- One engine to learn in depth, run locally (Docker Compose), operate on AWS, back up
  and monitor.
- Transactions and constraints protect identity and diary data.
- JSONB and full-text search keep the food catalog's options open.

**Negative**

- Catalog records need explicit JSONB modelling and migrations instead of a free-form
  schema.
- A document store is deliberately not practiced in this project, despite its learning
  value.
- If catalog search outgrows PostgreSQL, a dedicated search engine has to be added after
  all.

**Follow-ups**

- Decide how the food catalog implements search (PostgreSQL full-text and trigram search
  vs a search engine such as OpenSearch), after a spike on Open Food Facts data
  including Russian product names.
- Reconsider a document store only when a use case appears that JSONB handles poorly.
