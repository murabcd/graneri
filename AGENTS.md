# Repository Guidelines

## Knowledge Graph
`graneri` is a Bun workspace managed with Turbo. Graneri is desktop-first and
web-supported; `lat.md/` is the canonical knowledge graph for module interfaces,
runtime seams, desktop release invariants, Convex integration, and shared AI
tool contracts. Start with `lat.md/lat.md`, use `lat search` or `lat locate` to
find the relevant sections, and update the graph in the same change whenever a
documented contract moves. Run `bun run check:lat` after every graph change.

## Core Priorities
1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability
Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Build, Test, and Development Commands
Run `bun install` once at the repo root. Use `bun dev` to start the local stack, `bun run dev:web` for the web app only on port `3000`, `bun run dev:marketing` for the marketing site on port `3001`, and `bun run dev:desktop:native` when you need the packaged macOS desktop app for native permission or system-audio testing. Use `bun run build` for all workspace builds, `bun run test` (runs Vitest plus Convex tests) for all tests, `bun run typecheck` for TypeScript checks, and `bun run check` for Lat, Konsistent, and non-mutating Biome validation. Use `bun run check:lat` for the knowledge graph alone and `bun run check:konsistent` for cross-file structural conventions. Use `bun run check:fix` or `bun run lint:fix` when you intentionally want Biome to rewrite files. Package-scoped commands mirror the root flow, for example `cd apps/web && bun run test`.

Every `lat.md/` section must begin with a concise overview paragraph. Use
`[[wiki links]]` between architecture sections and supported source files, and
ordinary Markdown links for source extensions Lat cannot parse, including
`.mjs`, `.mts`, and `.swift`. `bun run check:lat` validates graph structure and
references; tests, package verification, and runtime checks remain the
executable enforcement for behavior.

For official desktop release checks, run `bun run dist:mac` with the hosted `GRANERI_HOSTED_*` values, then run `bun --filter=desktop run verify:package`. The package contract and failure conditions live in `lat.md/release.md`.

## Coding Style & Naming Conventions
Biome is the formatter and linter (`biome.json`). Use tabs for indentation, double quotes for JavaScript/TypeScript, and let Biome organize imports. `lint` and `check` should be treated as validation commands; `format`, `lint:fix`, and `check:fix` are the mutating commands. React component modules use kebab-case file names and PascalCase exports; hooks use `use-*.ts` or `use-*.tsx`; Convex modules use descriptive lower camel or kebab-free file names such as `notes.ts`. Prefer small shared UI additions in `packages/ui` rather than duplicating components in apps. Update `konsistent.json` when a repeated package, entry-module, or provider-tool structure intentionally changes.

## Code Quality
Avoid `any` types unless they are absolutely necessary and locally justified. Before guessing external API shapes, check the dependency's installed type definitions under `node_modules` and use the exported types. Never use inline imports: do not write `await import("./foo.js")` for runtime code or `import("pkg").Type` in type positions. Use standard top-level imports for runtime values and `import type` declarations for types.

Do not add generic `isRecord` or `asRecord` helpers. If a trusted value is
`unknown` at that point, stop and fix the upstream type flow first. Trusted
values must keep their source-derived types end to end. Truly unknown data must
be parsed once at its external, persisted, or SDK boundary with a named schema
that describes the actual contract, then passed downstream as the concrete
domain type. Do not rename or recreate a generic object or record guard.

Prefer source-owned types. Before declaring a type, reuse an existing exported
type or derive it with `typeof`, `ReturnType`, `Awaited`, `Parameters`, indexed
access, `FunctionReturnType`, `Infer`, `z.infer`, `Doc`, `Id`, `Pick`, or `Omit`.
When multiple modules consume the same semantic contract, export it from the
module that owns the corresponding runtime value, schema, or API. Keep a type
local when it describes genuinely private implementation state; do not export
implementation details merely to avoid a local type.

## Testing Guidelines
Web tests use Vitest with Testing Library and `jsdom`. Name tests `*.test.tsx` and keep them near feature-level behavior, as in `apps/web/tests/chat-page.test.tsx`. Run `bun run test` before opening a PR; for frontend changes, also run `bun run typecheck` and `bun run check`. Desktop changes should pass `bun --filter=desktop run typecheck` and `bun --filter=desktop run check`; native behavior should include targeted tests when practical or a clear manual verification note when it depends on macOS permissions, packaging, or system audio.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`. Keep commit subjects imperative and scoped to one change. PRs should include a short summary, linked issue if applicable, verification steps, and screenshots or recordings for visible UI changes. Call out any Convex schema or auth changes explicitly so reviewers can check deployment and environment impact.

## Security & Configuration Tips
Keep secrets in `.env.local`; do not commit local env files. Review `.env.example` when adding config.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
