# ADR-0003: Use bundler module resolution for TypeScript

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

TypeScript needs a module resolution strategy (`moduleResolution`) that matches how the
code is actually loaded, so that its errors reflect reality. We need an option that
works in a monorepo whose shared libraries are consumed by web apps bundled with
Rspack, a React Native app bundled with Metro, NestJS services bundled with webpack,
and Jest tests.

Inside the monorepo, an import such as `@fitadel/food-contracts` resolves through the
pnpm workspace link and the library's `package.json` `exports`, where the custom
`@fitadel/source` condition (enabled via `customConditions`) points to the TypeScript
source. Whatever strategy we choose has to keep supporting `exports` and custom
conditions.

The Nx default, `nodenext`, models native Node.js ESM. It requires relative imports to
name the emitted file (`./util.js` for `util.ts`). A spike showed that Metro and Rspack
fail to resolve such imports without extra configuration. No Fitadel code runs in
Node.js without a bundler or a test transformer.

## Considered options

1. **`nodenext` everywhere, mapping `.js` to `.ts` in each bundler.** Pros: TypeScript
   checks imports exactly as Node.js resolves them. Cons: `.js` imports of `.ts` files
   are confusing; every Rspack app needs `resolve.extensionAlias`, and Metro needs a
   custom resolver.
2. **`nodenext` by default, `bundler` overridden per project.** Pros: Node-accurate
   default. Cons: every generated project needs a manual override; a missed override
   fails late, inside a bundler.
3. **`bundler` globally** (`module: esnext`, `moduleResolution: bundler` in
   `tsconfig.base.json`). Pros: matches how all our code is consumed; extensionless
   imports work in every bundler and in Jest without extra configuration; supports
   `exports` and custom conditions. Cons: TypeScript no longer verifies that emitted code
   would run in plain Node.js.

## Decision

We will use **`moduleResolution: bundler`** with **`module: esnext`** in
`tsconfig.base.json` for all projects. A project whose output runs in Node.js without a
bundler overrides both settings to `nodenext` in its own tsconfig.

## Consequences

**Positive**

- Shared libraries work unchanged across Rspack, Metro, webpack and Jest.
- Imports are extensionless, matching common React and React Native conventions.

**Negative**

- A Node.js-only project (e.g. a script run with plain `node`, or a library published
  for Node.js consumers) must opt back into `nodenext`, or missing extensions will only
  fail at runtime.
- Generators that write their own `module` settings can override the base; their output
  has to be checked.

**Follow-ups**

- Verify the `module`/`moduleResolution` settings in each generated project.
- Make sure each bundler is configured with the `@fitadel/source` condition.
