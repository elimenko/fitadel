# Architecture decision records

This folder records significant architecture decisions: the context, the options
considered, the decision and its consequences.

## When to write one

When a decision is expensive to reverse, or likely to raise the question "why?".
Write it before significant work depends on the decision, not after the fact.

## How

1. Copy [template.md](template.md) to `NNNN-short-title.md`, using the next free number.
2. Fill it in, and add it to the index below.
3. Accepted ADRs are not edited. To change a decision, write a new ADR and mark the old
   one `Superseded by ADR-NNNN`.

## Index

| ADR                                              | Title                                        | Status   |
| ------------------------------------------------ | -------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)    | Record architecture decisions                | Accepted |
| [0002](0002-nx-monorepo-with-pnpm-workspaces.md) | Use an Nx monorepo with pnpm workspaces      | Accepted |
| [0003](0003-bundler-module-resolution.md)        | Use bundler module resolution for TypeScript | Accepted |
| [0004](0004-jest-unit-test-runner.md)            | Use Jest as the unit test runner             | Accepted |
| [0005](0005-postgresql-primary-database.md)      | Use PostgreSQL as the primary database       | Accepted |
