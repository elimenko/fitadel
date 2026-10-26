# ADR-0002: Use an Nx monorepo with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Fitadel consists of many deployables (web micro-frontends, a React Native app and
several backend services) that share code: domain types, API and event contracts,
validation, localization and UI. A contract change usually touches its producer and
its consumers at the same time. We need atomic cross-project changes, consistent
tooling and a CI that builds and tests only what a change affects.

## Considered options

1. **Polyrepo** (one repository per app or service). Pros: independent repositories,
   simple per-repo CI, clear ownership. Cons: shared code must be published as
   versioned packages; one contract change means several PRs and releases; tooling
   drifts between repositories.
2. **Monorepo with plain pnpm workspaces.** Pros: minimal tooling. Cons: no task
   caching, no affected detection and no dependency rules; build orchestration is
   manual.
3. **Turborepo.** Pros: simple model, fast task caching and pipelines. Cons: lighter
   feature set; basic code generation and no first-party support for React Native,
   NestJS or Module Federation.
4. **Nx.** Pros: project graph with inferred tasks, caching and `affected`;
   generators and plugins for React, React Native, NestJS and Module Federation;
   lint-enforced module boundaries. Cons: more concepts and configuration to learn;
   plugins are versioned with Nx and upgraded through `nx migrate`.

## Decision

We will use an **Nx monorepo** in the TypeScript "solution" setup: every project is
a pnpm workspace package, linked with the `workspace:` protocol and type-checked
through TypeScript project references.

We will use **pnpm** as the package manager for its strict dependency isolation
(no access to undeclared dependencies), its content-addressable store and its
explicit approval of dependency build scripts.

## Consequences

**Positive**

- Changes to contracts, services and clients land in one commit and one review.
- CI can run only the affected projects (`nx affected`), with cached results.
- Generators keep new projects consistent; module boundaries can be enforced by lint.

**Negative**

- Contributors need to understand Nx concepts (project graph, inferred tasks, caching).
- Nx and its plugins must be upgraded together, regularly, with `nx migrate`.
- pnpm fails installation until each new dependency's build script is reviewed and
  approved in `pnpm-workspace.yaml`.

**Follow-ups**

- CI with `nx affected`.
- Module boundary tags (`scope:*`, `type:*`, `platform:*`).
