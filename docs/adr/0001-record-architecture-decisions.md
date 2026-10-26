# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Fitadel spans web, mobile, backend services, messaging and cloud infrastructure. Many
choices are made deliberately to apply production-grade patterns rather than out of
strict necessity. Without a record, the reasoning behind decisions and the
alternatives that were rejected get lost. Decisions then get re-debated or reverted
without anyone understanding the trade-offs.

## Considered options

1. **No formal records** (commit messages and the README only). Pros: no overhead.
   Cons: reasoning is scattered and hard to find; rejected alternatives aren't captured.
2. **External wiki** (e.g. Notion, Confluence). Pros: rich editing. Cons: drifts away
   from the code, isn't versioned with it, and isn't visible in the repository.
3. **ADRs in the repository.** Pros: versioned and reviewed together with the code, and
   discoverable next to it. Cons: some writing overhead; needs discipline.

## Decision

We will keep ADRs in `docs/adr`, using the template in `docs/adr/template.md`
(the Nygard format extended with considered options). Each ADR records one decision,
is written when the decision is made, and is immutable once accepted: changes are
made by a new ADR that supersedes it.

## Consequences

**Positive**

- The reasoning and trade-offs behind the architecture stay traceable, including
  choices made deliberately to exercise a pattern.
- Revisiting a decision starts from its original context instead of from scratch.

**Negative**

- Writing an ADR adds overhead to every significant decision.
- The index in `docs/adr/README.md` is maintained by hand and can drift.

**Follow-ups**

- Record the monorepo decision as ADR-0002.
