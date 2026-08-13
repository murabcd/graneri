# Biome lint plugins

Every Graneri lint plugin is an anti-slop rule with one explicit responsibility.
Graneri adapts the high-signal rules from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) to Biome's GritQL
plugin runtime. `bun run lint:plugins`, `bun run lint`, and `bun run check` all
run the same canonical plugin set. There is no Oxlint dependency or fallback
configuration.

## Enforced structurally

- `no-chained-type-assertions.grit` rejects chained type assertions.
- `no-reflect-apply.grit` and `no-reflect-get.grit` reject reflective calls
  that discard typed contracts.
- `no-unknown-type-aliases.grit` keeps `unknown` visible at parsing boundaries.
- `no-object-parameters.grit` rejects broad `object` parameters.
- `no-shape-symbol-names.grit` requires domain names instead of structural
  `Shape` names.
- `no-conditional-empty-object-spread.grit` safely rewrites conditional spreads
  with an empty-object fallback to a direct conditional spread.
- The existing Graneri plugins reject `Record<string, unknown>`, generic
  `isRecord`/`asRecord` helpers, local-module Vitest mocks, Vitest global
  mutation, inline imports, and import-expression types.

The new plugins run only on authored JavaScript and TypeScript. Generated
directories are excluded.

## Type-aware rules

Biome's current GritQL plugins match syntax, not TypeScript scope or inferred
types. The upstream rules for runtime `typeof`, unknown parameters and returns,
known-value widening, widen-then-assert flows, and assertion-comment provenance
cannot be ported faithfully without false positives at Graneri's external data
boundaries. Those boundaries remain governed by the repository rule: parse
truly unknown data once with a named schema and preserve the concrete type from
there.

Third-party module mocks remain valid integration boundaries. Graneri's
existing plugin bans local module mocks, where mocking implementation details
would hide broken internal contracts.
