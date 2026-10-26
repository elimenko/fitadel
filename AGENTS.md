# Fitadel: agent guide

Calorie tracker for web and Android, built as an Nx monorepo. See `README.md` for the
overview and `docs/roadmap.md` for the plan.

## Working agreement

If `learning-principles/README.md` exists, read it before starting work and follow it.
It defines how changes are proposed and approved in this repository. The folder is
local and intentionally not versioned: never commit, quote or summarize its content in
versioned files, commit messages or pull requests.

## Commands

- Install: `pnpm install` (Node 24, pnpm 12)
- Run tasks through Nx: `pnpm nx <target> <project>`, `pnpm nx affected -t lint test build`
- Inspect: `pnpm nx show projects`, `pnpm nx graph`
- After adding a dependency between projects: `pnpm nx sync`
- Format: `pnpm exec prettier --write <files>`

## Repository layout

- `apps/web/*`, `apps/mobile`, `apps/services/*`: deployable applications
- `libs/<domain>/<lib>`: libraries grouped by domain; cross-domain code in `libs/shared`
- `docs/adr`: architecture decision records; `docs/roadmap.md`: phases

## Conventions

- Conventional Commits: `type(scope): subject`. The scope is the Nx project name;
  omit it for repository-wide changes.
- Significant decisions get an ADR before work depends on them (see
  `docs/adr/README.md`). Accepted ADRs are never edited, only superseded.
- TypeScript uses `moduleResolution: bundler` (ADR-0003). Relative imports are
  extensionless. Check that generated projects don't override it.
- When adding an Nx plugin, set its generator defaults in `nx.json`: ESLint, Jest,
  Rspack for web.
- Dependencies with install scripts must be reviewed and approved in
  `pnpm-workspace.yaml` (`allowBuilds`).

## Boundaries

- Never commit secrets (`.env`, keys, kubeconfigs, Terraform state). Commit `*.example`
  templates instead.
- Never create billable cloud resources without stating the cost and the teardown
  command first.
- Never push, force-push or rewrite history without explicit approval.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
