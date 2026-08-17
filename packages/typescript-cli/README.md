# TypeScript CLI boundary

The repository uses the native TypeScript 7 compiler, but Vercel's Node
function builder still loads a local `typescript` package through the removed
JavaScript compiler API. This workspace package exposes only the `tsc` binary,
so local and CI typechecks stay on TypeScript 7 while Vercel uses its bundled
compiler solely to transpile function entrypoints.

Keep the executable at the standard `bin/tsc` path because package tooling,
including the Convex CLI, resolves that path directly.

Keep this package version and its platform packages aligned when upgrading
TypeScript. Remove the boundary once `@vercel/node` supports the TypeScript 7
API.
