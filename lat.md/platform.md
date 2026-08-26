# Platform Interface

The platform package is the sole renderer-safe interface to Electron capabilities and packaged renderer routes.

- [[renderer]] consumes the bridge.
- [[desktop-runtime]] implements the native adapters.
- [[packages/platform/src/desktop-ipc-contract.ts]]

## Desktop bridge

A typed capability catalog defines IPC parity across renderer helpers, preload methods, handlers, subscriptions, and tests.

Desktop capabilities are first-class platform interfaces, not incidental browser
fallbacks. This is the only renderer-safe package that may read
`window.graneriDesktop`.
Renderer code must access desktop capabilities through this package.
`desktopIpcContract` is the authoritative capability-to-channel catalog for
invoke, send, subscription, and test-only IPC. The typed bridge must have exact
method parity with that catalog, preload methods are derived from it, and the
main process fails startup when a required handler is missing, duplicated, or
unexpected. Desktop builds bundle the preload so the shared catalog does not
become a packaged runtime dependency.

## Application menu commands

Native menu commands cross the same typed bridge and reuse renderer action owners instead of synthesizing keyboard input.

Native application-menu commands that act on renderer state cross this same
bridge as typed semantic commands. Electron must not synthesize keyboard input;
renderer command owners share the action handlers used by real shortcuts.

## Renderer routes

One platform manifest identifies packaged renderer routes for the desktop protocol.

Renderer route ownership lives in `packages/platform/src/renderer-routes.mjs`.
The packaged desktop protocol must use that manifest to decide whether an
`app://ui` pathname is a renderer route. Desktop protocol code must not carry a
private duplicate list of renderer route prefixes.
