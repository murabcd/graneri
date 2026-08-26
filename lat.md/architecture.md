# System Architecture

Graneri is desktop-first and web-supported, with narrow interfaces connecting the renderer, Electron, shared packages, hosted web routes, and Convex.

- [[renderer]] owns browser-safe presentation and renderer sessions.
- [[platform]] is the only renderer-safe desktop bridge.
- [[assistant-runs]] and [[connected-apps]] own shared AI behavior.
- [[convex]] owns durable backend state and authorization.
- [[desktop-runtime]] and [[release]] own installed runtime and distribution invariants.

## Runtime model

The Electron application packages the web renderer and coordinates with Convex and hosted web routes through explicit runtime interfaces.

Graneri is desktop-first and web-supported. `apps/desktop` packages the Vite
renderer from `apps/web` and talks to Convex for backend state and AI actions.

## Repository modules

The workspace assigns each runtime and shared concern to one primary module while domain graphs document interfaces that cross those modules.

- [apps/desktop](../apps/desktop/package.json) owns Electron main and preload,
  native permissions and capture, the local server, packaging, updates, and
  desktop release behavior.
- [apps/web](../apps/web/package.json) is the Vite and React renderer shared by
  the installed desktop app and browser entrypoint.
- [apps/marketing](../apps/marketing/package.json) is the standalone Vite and
  React marketing site.
- [packages/ai](../packages/ai/package.json) owns shared AI runtime modules,
  hosted orchestration, tool contracts, transcription helpers, and connected-app
  capability metadata.
- [packages/platform](../packages/platform/package.json) owns renderer-safe
  desktop bridge types and platform helpers.
- [packages/ui](../packages/ui/package.json) owns shared UI primitives.
- [convex](../convex/package.json) owns backend functions, schema, durable state,
  authentication, HTTP actions, and server integrations.

## Documentation contract

This graph must change with every architecture, packaging, release configuration, or Convex integration contract change.
