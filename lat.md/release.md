# Release and Verification

Release modules keep hosted configuration aligned across runtimes, package only declared artifacts, and verify the final signed distribution shape.

- [[desktop-runtime]] defines installed runtime ownership.
- [[transcription]] defines native helper behavior covered by package verification.
- [package contract](../apps/desktop/scripts/desktop-package-contract.mjs)
- [package verifier](../apps/desktop/scripts/verify-package.mjs)

## Managed local runtimes

The macOS package includes pinned Python and Node interpreters and libraries for local data, document, spreadsheet, PDF, and image work.

[prepare-local-runtime.mjs](../apps/desktop/scripts/prepare-local-runtime.mjs) downloads the architecture-specific Python standalone and official Node archives declared in [local-runtime-contract.mjs](../apps/desktop/src/local-runtime-contract.mjs), verifies their SHA-256 digests, and installs only hash-locked wheels. It uses the downloaded interpreter's isolated pip, so end users need no Python, package manager, or network setup. The generated build cache is reused only when its archives/requirements fingerprint and import verification pass. Failed preparation does not publish a partial runtime.

Desktop development and packaging prepare this runtime; hosted Vercel web builds and the Docker artifact worker do not. Packaging dereferences the standalone distribution's links and places it under `dist-electron/main/local-runtime` outside ASAR. Package verification requires the runtime files and executes Node and Python to check their versions and every declared Python library. Lock regeneration uses the command recorded in `apps/desktop/local-runtime/requirements.in`; upgrades change the archive digest and/or requirements lock deliberately.

## Hosted runtime configuration

Official packages embed the same public hosted deployment in Electron and the renderer without embedding secrets.

Official packaged desktop builds must embed public hosted URLs in both runtime
layers:

- Electron main/runtime config:
  `apps/desktop/dist/hosted-runtime-config.mjs`, bundled into
  `dist-electron/main/index.js`
- Vite renderer constants: `apps/web/dist`, copied into packaged `dist-app`

Electron main and the packaged Vite renderer must point at the same hosted
Convex deployment.

Hosted URLs are public configuration, not secrets. They identify hosted Convex
and web deployments. Never embed `OPENAI_API_KEY`, `BETTER_AUTH_SECRET`, OAuth
client secrets, deploy keys, or signing credentials into desktop builds.
`OPENAI_API_KEY` must be configured in the hosted Convex deployment for normal
durable chat actions. The hosted web deployment still needs its own key for
desktop-local chat turns, note/template generation, and realtime session
creation; neither value belongs in a renderer or packaged desktop artifact.

Official builds pass:

```sh
GRANERI_HOSTED_CONVEX_URL=https://<prod-deployment>.convex.cloud
GRANERI_HOSTED_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
GRANERI_HOSTED_SITE_URL=https://<hosted-app-origin>
```

## Vercel deployment

One pinned GitHub workflow builds and deploys production only after validation, with the Vercel Git integration disconnected.

Vercel deployments have one owner: `.github/workflows/deploy-vercel.yml`.
That workflow pins Vercel CLI `59.5.0`, pulls the selected Vercel environment,
builds locally with `vercel build`, installs from the frozen Bun lockfile, and
deploys only the prebuilt output.
For pushes to `main`, `ci.yml` calls the deployment workflow only after all
validation passes; an explicit manual dispatch is also available. Pull requests
are validation-only. `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
`VERCEL_PROJECT_ID` are GitHub repository secrets. Public build-time values are
non-sensitive Vercel config, while runtime credentials remain sensitive. The
Vercel Git integration must remain disconnected so a second hosted builder
cannot race or bypass this release boundary.

## TypeScript and builder compatibility

TypeScript and Vercel CLI changes require a production-targeted build instead of compatibility package shims.

The workspace depends directly on the native TypeScript `7.0.2` package. Do
not add a package named `typescript` to adapt an older deployment builder.
Upgrading either TypeScript or the pinned Vercel CLI requires a successful
production-targeted `vercel build --prod` plus the normal repository checks
before the deployment workflow changes.

## Environment, identity, and signing

Local and production deployments, bundle identifiers, hosted dependencies, signing, and notarization remain explicit separate states.

Local development builds stay local. `bun dev` and desktop dev runs load local
runtime values and connect to the development Convex deployment.
Rebuilding or packaging the desktop app does not deploy its hosted dependencies.
Before distributing or installing a desktop build that depends on new Convex
functions, HTTP actions, or schema, deploy those changes to the exact hosted
Convex deployment embedded in the package. Deploy associated Vercel handlers
before the desktop build depends on them. Verify the deployed function and HTTP
route inventory rather than treating a successful desktop build as evidence
that its hosted runtime is compatible.
Production desktop packages default to the `com.graneri.desktop` bundle
identifier. Local/dev packages keep `dev.graneri.desktop` so installed
production builds and repo-built verification bundles do not share macOS app
identity.
Official macOS production packages must be Developer ID signed and notarized so
macOS treats Graneri as a stable, trusted app identity for system surfaces such
as notifications, login items, and permission prompts. Local verification
packages may remain ad-hoc signed, but production packaging must not. Signing
identities and notarization credentials must come from the CI keychain or
environment and must never be embedded in the packaged runtime. CI may set
`GRANERI_MAC_SIGNING_IDENTITY` when it needs to choose a specific certificate
instead of Electron Builder's automatic discovery.

## Packaged dependencies

Every third-party runtime dependency consumed through desktop or shared packages is declared by the desktop package.

Electron Builder packages dependencies from `apps/desktop/package.json`.
`@workspace/ai` is a direct desktop dependency because desktop main-process
code consumes its public modules. Any third-party package imported by packaged
desktop runtime code through `apps/desktop`, `packages/ai`, or copied runtime
modules must also be declared there.

## Generated artifacts and tracing

The package contains generated artifacts, bundled JavaScript, traced asset-backed runtimes, explicit assets, and declared native dependencies.

The artifact-authoring worker is released as an independent Vercel Fluid
Compute project rooted at `apps/artifact-worker`. Its pinned
`Dockerfile.vercel` image owns LibreOffice, Poppler, fonts, and Python authoring
libraries; none of those dependencies enter the web or desktop bundle. The web
deployment and artifact-worker deployment require separate verification and
must never be reported as one release surface. Vercel browser-login protection
must remain disabled for this dedicated service so Convex can reach it; the
worker's own shared-secret boundary protects authoring requests and callbacks.
See [[artifact-authoring]].

The desktop build packages generated runtime artifacts only. Packaged Electron
main code lives in `dist-electron/main/index.js`, and packaged renderer assets
live in `dist-app`. Packaged windows load renderer assets through `app://ui`.
Packaged runtime code must not rely on source-tree imports. JavaScript runtime
dependencies belong in the main-process bundle unless their published runtime
loads worker, WASM, or adjacent package assets by path. An asset-backed runtime
must be externalized from the Bun main bundle and traced from the final bundled
Node entrypoint with `@vercel/nft`. Worker entrypoints that load their own
dependencies are additional trace roots. Native optional dependencies are
excluded unless Graneri explicitly uses them. Native modules that cannot be
bundled remain platform-specific optional dependencies. Every traced runtime
and explicitly staged asset must be covered by the package contract and
verifier.

## Package contract

One package contract owns paths, ASAR rules, trace policy, explicit assets, exclusions, and executable runtime verification.

The generated package shape is owned by
`apps/desktop/scripts/desktop-package-contract.mjs`. Build scripts, Electron
Builder config, and package verification must read package paths and ASAR
rules from that module instead of repeating release layout strings. Its runtime
trace policy declares external packages, worker entrypoints, explicit assets,
ignored packages, and required packaged files; main-bundle externalization,
targeted ASAR unpacking, and package verification derive from that policy.
`runtime-file-trace.mjs` owns programmatic NFT tracing, deterministic
path normalization, and flattened-path collision detection. It traces the final
main bundle for remaining external JavaScript dependencies without claiming
explicit native/resource paths, then traces declared worker entrypoints with
asset analysis enabled. Python's CPython bundle and SQLite's WASM binary remain
explicit assets. Electron, `objc-js`, and unused optional native compression
packages are explicit trace exclusions. Unresolved or otherwise unexpected NFT
warnings fail the build; NFT's known script-parser fallback warning is accepted
only when an `.mjs` file is subsequently parsed as a module.
`packaged-runtime-verification.mjs` owns executable verification of the unpacked
JavaScript, Python, SQLite, and native helper runtimes; the main package verifier
runs static ASAR, configuration, and import checks through
[package-verification.mjs](../apps/desktop/scripts/package-verification.mjs)
before executing runtime smoke tests. Static checks are exercised against temporary
ASAR archives and their unpacked mirrors, without reading verifier source text.

## ASAR layout

The app runtime stays in app.asar with narrowly targeted unpacking for native helpers and asset-backed runtimes.

Desktop packages must keep the app runtime in `Contents/Resources/app.asar`.
Only native helpers, bundled media tools, and asset-backed worker/WASM runtimes
may be unpacked into `Contents/Resources/app.asar.unpacked` through targeted
`asarUnpack` rules.
Runtime helper resolution must prefer the unpacked mirror before development
helper paths. Electron currently emits a terminal-only Node `DEP0180` warning
from its internal ASAR filesystem adapter (`electron/electron#47390`); do not
disable ASAR or add app-level suppression for that upstream warning.

## Required package verification

Verification inspects the final app.asar and unpacked mirror and rejects stale configuration, missing dependencies, and broken helpers.

After building the desktop package, run:

```sh
bun --filter=desktop run verify:package
```

The package verifier reads the final `app.asar` and its unpacked mirror only.
Generated `.package-app` staging output is not a release artifact and must not
satisfy package verification.

The verifier must fail if:

- The packaged `Contents/Resources/app` runtime contains a stale development
  Convex deployment.
- The packaged `Contents/Resources/app` runtime misses the expected hosted
  Convex deployment.
- The bundled renderer contains stale dev Vite constants.
- Packaged runtime code imports Convex server TypeScript.
- Bare package imports in `dist-electron` cannot resolve from packaged
  `node_modules`.
- The final packaged `just-bash` runtime cannot execute JavaScript, start its
  Python worker, or load SQLite and run a basic in-memory query.
- Required native runtime helpers are missing, or the combined audio helper
  fails its AEC3 self-test, including residual-leak gating for active system
  audio.

## Enforcement

Lat validation, repository checks, typechecking, tests, production builds, and package verification turn recurring prose failures into executable gates.

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.
Vercel deployment-boundary changes must also pass `vercel build --prod` with
the production environment pulled for the linked project.
Desktop realtime transcription changes must include the desktop transport tests
for stop-flush behavior, native audio tests for combined-helper AEC3 behavior,
and renderer auto-stop tests for meeting/idle state.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
