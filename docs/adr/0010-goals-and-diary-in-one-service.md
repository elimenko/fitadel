# ADR-0010: Keep goals and the food diary in one service

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Phase 3 adds two features:

- **Goals:** the user enters their maintenance calories and a deficit or surplus, in %
  or in kcal, which gives a daily calorie budget. Targets for protein, fat and fiber are
  in grams; carbs get the calories that are left. A goal applies from a chosen date, so
  past days keep the budget they had.
- **Food diary:** entries in fixed meals on any date. A food entry copies the food's
  nutrients from the catalog when it is logged; a manual entry holds calories and,
  optionally, macros. Entries and whole meals can be copied to another day.

The main read is a day: what was eaten in each meal, the totals, and how they compare
with that day's budget and targets. Every diary screen needs the goal that applies.

The existing services are split by the data they own: identity owns accounts and
sign-in, the catalog owns foods. Where goals live has to be settled before Phase 3
generates its first service.

## Considered options

1. **One `diary` service owning goals and entries.**
   - Pros:
     - A day, with its budget, comes from one database in one query, always consistent.
     - One service to run, deploy and monitor.
   - Cons:
     - Two features in one deployable; it grows if goals grow (activity-adjusted
       budgets in Phase 7).
2. **Separate `goals` and `diary` services.**
   - Pros: each service stays small and deploys on its own.
   - Cons:
     - Every day view needs both: either a synchronous call (no diary while goals is
       down) or a copy of the goals kept current by events (briefly stale after a
       change).
     - One more service to run, for a boundary that cuts one feature (a day's balance)
       in two.
3. **Goals in identity, as profile data.**
   - Pros: no new place for goals.
   - Cons:
     - Puts nutrition rules into the security-critical service; identity's data is
       about who the user is, not what they aim to eat.
     - The diary still needs a call to identity for every day view.

## Decision

We will keep goals and diary entries in **one `diary` service** with its own database,
because the day view needs both and they change together. Splitting them would add a
network hop or eventual consistency to every day view, for independence that nothing
needs at this size.

## Consequences

**Positive**

- A day view, including the remaining budget and whether the user is above or below
  it, is one request against one database.
- Phase 3 adds one service, not two. gRPC and Kafka are used at a boundary that already
  exists: between the diary and the catalog.

**Negative**

- One service holds two features. Splitting later means moving tables and adding an API
  between the two parts.
- Other services can read goals only by asking the diary.

**Follow-ups**

- Phase 3 Step 2: generate `diary` with its own database and roles, routed at
  `/api/diary/`.
- Phase 7: revisit if activity-adjusted budgets need their own data and sync jobs.
