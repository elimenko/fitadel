# ADR-0004: Use Jest as the unit test runner

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Fitadel needs unit tests in four kinds of projects: shared TypeScript libraries, NestJS
services, React web apps bundled with Rspack, and a React Native app. One runner across
all of them keeps configuration, mocking APIs and CI output uniform.

## Considered options

1. **Jest everywhere.** Pros: React Native's official preset and Nx's Nest generators are
   built on Jest; one API and one config style; mature mocking. Cons: slower than
   Vitest; ESM-only dependencies need transform configuration.
2. **Vitest everywhere.** Pros: fast, native ESM, Jest-compatible API. Cons: React Native
   support is unofficial; its main advantage, reusing the Vite config, doesn't apply
   because we bundle with Rspack, Metro and webpack.
3. **Mixed: Vitest for web and libs, Jest for React Native and Nest.** Pros: the fastest
   runner where it works best. Cons: two runners, two mocking APIs, and shared libs
   tested under a different runner than some of their consumers.

## Decision

We will use **Jest** in every project, with SWC as the transformer.

## Consequences

**Positive**

- One runner and API across the stack; generators produce consistent configs.

**Negative**

- Slower test runs than Vitest.
- ESM-only packages may need `transformIgnorePatterns`.

**Follow-ups**

- Revisit if Vitest gains official React Native support. The APIs are close, so switching
  would be cheap.
