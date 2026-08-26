# Desktop Runtime

Electron owns native lifecycle, tray state, diagnostics, loopback transport, packaged content security, authentication storage, and native adapters.

- [[platform]] exposes narrow renderer-safe interfaces.
- [[release]] defines packaging and verification.
- [boot orchestrator](../apps/desktop/src/desktop-boot-orchestrator.mjs)

## Theme and dictation overlay

Electron follows the persisted app theme while the overlay uses self-contained palettes and requires no screen-pixel inspection.

Electron main owns preload, IPC, native permissions, capture helpers, the local
server, packaging, updater behavior, and desktop release configuration.
The global dictation overlay uses self-contained light and dark palettes selected
through `prefers-color-scheme`. Electron's native theme follows the renderer's
persisted app theme, including macOS appearance when the app theme is System.
The overlay does not inspect screen pixels, so global dictation does not require
Screen Recording permission.

## Content security policy

Packaged renderer documents restrict scripts and network origins to the explicit capabilities required at runtime.

Packaged renderer documents are served with a Content Security Policy. Network
connections are limited to the configured Convex and hosted-site origins,
their WebSocket equivalents, the desktop loopback API, and the explicit OpenAI
and GitHub endpoints used by renderer capabilities. Inline scripts are not
allowed; the pre-render theme initializer is a packaged static asset.

## Tray state

Electron owns tray rendering and meeting selection over renderer-synced calendar data, with bounded one-time navigation requests.

Desktop tray state belongs to Electron. It may mirror renderer-owned account,
workspace, and preference state for actions such as notification policy and note
creation, but tray event discovery itself is a desktop-native responsibility.
Renderer changes that affect desktop-owned tray behavior should notify Electron
to refresh the tray.
Tray calendar events come from the authenticated renderer's connected-calendar
query result and are pushed into Electron through the desktop bridge. Electron
must own tray state, menu rendering, notifications, and meeting-signal
selection from that synced data. The tray must not fetch Convex directly or
depend on a separate desktop auth-token refresh path to show upcoming meetings.
Electron keeps tray-note events in a bounded, expiring request registry and puts
only an opaque request UUID in navigation. The renderer consumes the complete
validated event once through the desktop bridge; invalid, expired, or oversized
requests fail closed and never synthesize an empty attendee snapshot.

## Application lifecycle

One boot orchestrator owns startup, single-instance behavior, suspend handling, cleanup, and awaited shutdown order.

Desktop app lifecycle sequencing is owned by
`apps/desktop/src/desktop-boot-orchestrator.mjs`. The Electron main module may
compose concrete adapters, but lifecycle ordering for single-instance handling,
ready startup, suspend handling, window-all-closed cleanup, and before-quit
cleanup must stay behind the boot orchestrator interface.

## Diagnostics

Electron owns bounded performance traces, unified logs, rotated structured events, paths, and shutdown of diagnostic resources.

Desktop diagnostics are owned by Electron in
`apps/desktop/src/desktop-diagnostics.mjs`. The native Help menu may start a
bounded Chromium performance trace, toggle a macOS unified-log stream, and open
the dedicated `userData/troubleshooting-logs` directory. Structured desktop
events are persisted asynchronously to a size-rotated
`troubleshooting-logs/graneri.log`. `desktop-diagnostics-paths.mjs` is the single
owner of these filesystem locations. Diagnostic streams, active traces, local
services, and the file logger must finish through the awaited boot-orchestrator
shutdown path before Electron is allowed to quit.

## Local server

Node HTTP transport delegates reusable routing, proxy, transcription, and local-folder behavior to dedicated modules.

The desktop local server keeps Node HTTP transport and route dispatch in
`apps/desktop/src/local-server.mjs`. Reusable HTTP/CORS behavior, hosted AI
proxying, realtime transcription session creation, and local folder tool
execution live behind dedicated local-server modules. Electron contains no
model, response, lifecycle, or AI SDK implementation; the loopback server
preserves hosted request and response semantics. Shared hosted chat helpers own
prompt construction, run-plan assembly, tool-loop setup, branch preparation,
save payloads, active-stream persistence, and stream finalization mechanics.

## Desktop authentication storage

Owner-only JSON cookie storage and an isolated Chromium profile keep routine desktop auth out of Keychain prompts.

Desktop auth cookies persist in an explicit JSON store under Electron's
`userData` directory with owner-only file permissions. Packaged OSS builds must
not use Electron Safe Storage, macOS Keychain, or another OS credential prompt
for routine session-cookie persistence. Renderer windows must not use Electron's
default persistent Chromium profile as an auth store; desktop auth state belongs
to the IPC auth bridge and desktop auth cookie store. Desktop startup must pass
Chromium's mock-keychain switch before renderer windows are created so Chromium
storage never opens the macOS Keychain prompt.
