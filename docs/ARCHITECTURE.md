# Architecture

Graneri is desktop-first and web-supported. `apps/desktop` packages the Vite
renderer from `apps/web` and talks to Convex for backend state and AI actions.

This document is the system of record for runtime boundaries and release
invariants. Update it only when a boundary, packaging rule, release
configuration path, or Convex integration contract changes.

## Ownership

`apps/desktop`
: Electron main, preload, IPC, native permissions, capture helpers, local
server, packaging, updater behavior, and desktop release configuration.
The global dictation overlay uses self-contained light and dark palettes selected
through `prefers-color-scheme`. Electron's native theme follows the renderer's
persisted app theme, including macOS appearance when the app theme is System.
The overlay does not inspect screen pixels, so global dictation does not require
Screen Recording permission.

`apps/web`
: React renderer for both desktop and browser. Desktop releases still depend on
the Vite bundle, so renderer constants are part of desktop release correctness.
`useRendererChatSession` is the renderer boundary for AI SDK transport, desktop
local-tool handoff, active-run resume, persisted-message reseeding and merging,
and durable follow-up drain and controls. Full chat and note chat remain view
adapters: they own composer and presentation behavior but must not assemble
parallel stream, recovery, or queue lifecycles.
The note document session is the authoritative module for note hydration, local
draft recovery, remote reconciliation, debounced saves, per-note in-flight save
serialization, and flush-on-navigation behavior. The note page remains a view
adapter: it projects session documents into Tiptap and must not rebuild save or
draft ordering with local effects and refs.
The application navigation session is the authoritative renderer boundary for
URL-derived route state, settings history restoration, desktop and popstate
synchronization, pinned-inbox behavior, transient note-capture intent, and
workspace-scoped resource-route resolution. The authenticated shell invokes
typed navigation methods and renders the resolved snapshot; it must not mutate
parallel route state cells or write browser history directly.
The desktop permissions session is the renderer authority for loading and
refreshing native permission status, request and system-settings transitions,
readiness, and onboarding completion. It consumes the narrow platform bridge
and treats a missing bridge as a runtime error; it must not synthesize legacy
permission rows. Native probing, prerequisite ordering, and permission error
classification remain in Electron main behind IPC.

`packages/platform`
: The only renderer-safe package that may read `window.graneriDesktop`.
Renderer code must access desktop capabilities through this package.
`desktopIpcContract` is the authoritative capability-to-channel catalog for
invoke, send, subscription, and test-only IPC. The typed bridge must have exact
method parity with that catalog, preload methods are derived from it, and the
main process fails startup when a required handler is missing, duplicated, or
unexpected. Desktop builds bundle the preload so the shared catalog does not
become a packaged runtime dependency.
Native application-menu commands that act on renderer state cross this same
bridge as typed semantic commands. Electron must not synthesize keyboard input;
renderer command owners share the action handlers used by real shortcuts.

`packages/ai`
: Shared AI runtime code. It must not import Convex server modules or
`convex/*.ts`; server-only behavior must enter through adapters or Convex
client/action boundaries. Imports from `convex/_generated` are allowed only for
typed client function references and generated data-model types, not server
implementation coupling. The package is consumed through the explicit
`@workspace/ai/*` exports declared in `packages/ai/package.json`; applications,
Convex functions, and consumer-owned tests must not reach into
`packages/ai/src`. AI runtime tests live with the package and may exercise its
private modules directly, while integration tests stay with their consuming
application or Convex surface. Hosted chat helpers own shared run-plan assembly,
prompt construction, active-turn input preparation, branch preparation,
tool-loop setup, message persistence payloads, and active-stream persistence
behavior; the hosted web route provides Convex reads and writes, request
transport, and desktop-local tool declarations through small adapter callbacks.
Turn input buffering is separate from active-stream transport: the hosted turn
input buffer owns pending steer/mailbox ordering, wait-agent activity
notifications, and mailbox deferral rules, while active-stream sessions own
broadcast, replay, abort, and persistence.
The hosted chat route uses the shared user-message persistence helper for normal
saves, queued replay accepts, queued steer batch accepts, and continued-run
message appends; the route keeps HTTP telemetry and response formatting while
shared modules own chat behavior.
The hosted web chat route delegates active-run policy, same-run validation,
queued acceptance headers, assistant-run start, stream finalization, initial
AI SDK stream piping, and reconnect stream piping to its hosted stream runtime
module so HTTP parsing/context assembly stays separate from turn execution.
Assistant run start and active-stream session start share one runtime helper so
both web and desktop choose the same reject/supersede policy, reuse matching
continued runs, terminalize failed starts, and clean up partially-created stream
sessions.
Hosted chat runs are durable Convex lifecycle records.
`assistantRunStateMachine` owns run creation, allowed transitions, ordered
lifecycle events, and mandatory queue/snapshot cleanup; `assistantRuns` exposes
the public Convex function adapters and lifecycle queries. Chat and queue modules
must cross the state-machine seam instead of patching `assistantRuns` rows.
Together they enforce stop/failure/completion history and the
one-active-run-per-chat invariant. `chatActiveStreams` and active
`chatToolCalls` are temporary render
snapshots scoped to a run; terminal runs must leave no stream or active tool
snapshots behind. These records do not move desktop-local tool execution out of
the renderer/local-server bridge.
`assistantRunEvents` is the durable ordered timeline for a run. It records typed
events such as run start/stop/fail/complete, tool lifecycle changes, completed
assistant messages, and human-input requests. Events are append-only per run and
queried by `runId` plus `eventIndex`. Tool lifecycle events must be
self-contained for replay/debugging: started events carry the serialized tool
input when available, and completed events carry serialized output or error
details when available. High-frequency streamed text belongs in the active
stream snapshot during the run and in the saved assistant message after
completion; it should not be duplicated as per-token event rows.
Active stream snapshot writes are fail-closed runtime state. Appending text or
tool lifecycle updates to a missing snapshot, wrong run, or non-running run is a
producer/state divergence and must surface as a stream failure that terminalizes
the run; it must not silently drop output.
The client stream must not close as successful until completed-run finalization
has saved the assistant message, closed temporary stream/tool snapshots, and
terminalized the `assistantRuns` record. Finalization failures are request
failures, not background cleanup. A failed finalization attempt must leave the
same terminalization pending so a later flush can retry; it must not poison the
finalization queue with a permanently rejected in-flight promise.
Reconnect recovery follows the same no-leftover rule: when a reconnect finds a
non-terminal run without a live in-process stream producer, the route must mark
the run stopping, attempt to save/delete the active stream snapshot, and
terminalize the run in a `finally` path. Snapshot cleanup failures may still
surface to the caller, but they must not leave the run blocking future queue
drain or chat sends. Manual stop uses the same shape: record durable stop
intent before stream cleanup, and terminalize in `finally` after cleanup is
attempted.
Snapshots remain the live render surface; historical inspection, future missed
event replay, and debugging should use run events plus saved messages rather
than preserved snapshot rows.
AI SDK stream resume must attach to a non-terminal `assistantRuns` record and a
live in-process producer. It must not infer lifecycle from partial stream text.
If Convex has an attachable run but the current process has no matching producer,
the run fails and temporary snapshots are cleaned up rather than returning a
synthetic stream. Resume request preparation must fail when required workspace
or authentication state is unavailable; it must not fall back to the normal chat
send endpoint.
Human-blocking assistant work uses `waiting_for_user` plus a typed
`pendingDecision` on the run. Producers must resume the same run after the
decision instead of creating a second active run. Normal duplicate sends must
reject before persisting a new user message when a chat already has a
non-terminal run; clients must queue follow-ups against the active run.
`startAssistantRun` only supports reject or explicit supersede policies;
it must never return an existing active run as a fallback. Assistant runs are
created directly as `running`; queued work is represented by
`assistantQueuedMessages`, not by a queued assistant-run status. Queries that
attach to or report the active run must fail closed if more than one
non-terminal run exists for a chat, because choosing a winner would hide a
broken single-flight invariant. Regenerate is the explicit supersede path. Stop requests are
idempotent at the HTTP boundary: no attachable run means there is nothing left
to stop, so the route may return success without creating synthetic run state.
Follow-up queueing is durable run state, not UI-local buffering.
`assistantQueuedMessages` stores queued user messages and durable request
context scoped to the active run. It must not persist desktop-local folder
selections; follow-ups that need local folders must wait for the active answer
instead of entering the durable queue. Completed runs leave queued follow-ups
for the client drain path, which claims the next queued item only after no
non-terminal run remains for the chat. User input uses upstream app-server input
gates: HTTP chat routes and client queue serialization reject empty user text
before it can enter the AI SDK loop or durable queue state. Convex chat and
queued-message mutations enforce the actual 1 MiB document limit with
`getDocumentSize` at the write boundary instead of approximating storage size
from character counts. Queued rows persist one canonical text value plus the
minimum replay context: they omit credentials, desktop-local folder selections,
duplicate workspace identity, and note contents that can be reloaded by note ID.
Claimed replay is still server-owned: the client
rebuilds request state through the queued-intent module with a fresh Convex
token and sends `replayQueuedMessageId`; `/api/chat` must load the claimed
durable queue row and reconstruct the user message from that row before branch,
tool-policy, or persistence preparation. It must then atomically save the user
message and delete the claimed queue row through `acceptQueuedUserMessage`
before starting the assistant run. A client may call `discardClaimed` only when
submission fails before the server accepts the replay; successful replay must
not depend on a second client cleanup mutation. Post-accept replay setup
failures must carry `X-Graneri-Replay-Accepted: true` and
`X-Graneri-Replay-Queued-Message-Id` so the transport can resolve the already
accepted input as an empty successful stream instead of rolling it back. Manual
steer must be prepared as a queued steer intent and sent through
`/api/chat/steer` with both `steerQueuedMessageId` and the expected active
`continueRunId`; ordinary `/api/chat` requests must reject steer payloads
instead of falling back to implicit behavior. The hosted route must return a
structured `{ error, errorCode }` JSON body for
queued replay and steer validation failures, and must reject malformed IDs
before Convex state lookup or mutation. Steer input is queue-id driven: the
server reconstructs the user message from the claimed durable queue row and must
not require or trust a client-supplied `message` body. The hosted chat turn
controller claims the queued message through adapter callbacks, interrupts an
actively running stream and saves partial assistant output, or resumes the same
run directly when the run is `waiting_for_user`. The route then atomically
accepts the claimed queue row by saving the user message, recording
`turn.steer.accepted` plus `user.message.appended` on the same `assistantRuns`
timeline, clearing any pending decision, deleting the claimed queue row, and
starting the next assistant stream without terminalizing the run. Both replay
and steer accept mutations validate the saved user message id, text, and model
text parts against the claimed durable queue row; callers must not trust
client-supplied message bodies over durable queue state. The streaming response
carries `X-Graneri-Steer-Accepted: true`, `X-Graneri-Turn-Id`,
`X-Graneri-Queued-Message-Id`, and `X-Graneri-Queued-Message-Ids` headers after
the atomic accept succeeds so clients can distinguish accepted steering from
ordinary sends without changing the AI SDK stream body; the singular queued id
identifies the targeted steer row and the plural header lists the full accepted
batch. Post-accept setup failures must preserve these headers because the steer
was already accepted by the active turn. The web transport
must treat non-2xx steer responses with these headers as accepted empty streams
instead of rolling back the queued UI item; pre-accept failures without the
headers still surface as normal send failures. Stop, supersede, and
completed-run cleanup remove claimed queue rows for terminalized run state.
Any chat-level cleanup path that stops an active run, including branch
truncation and chat removal, must also append the stopped run event, delete live
snapshots, and discard both queued and claimed follow-ups for the stopped run.
Client cleanup mutations for individual queued or claimed rows must be scoped
by workspace and chat and must fail closed when the row belongs to another chat
or is in the wrong queue state; wrong-scope cleanup must preserve the row rather
than hide a stale client or cross-session bug.
Chat deletion and branch truncation must fail closed on invalid persisted
attachment metadata or storage ids; cleanup must not silently skip malformed
stored attachment references and continue deleting surrounding chat state.
Otherwise stale claimed rows are requeued by Convex claim mutations before the
next claim attempt, because `claimed` represents an unaccepted in-flight
operation and must not become an invisible durable leftover after a client or
transport crash. Durable queued request state must not persist desktop-local
folder scope or absolute paths; follow-ups that need local-folder tools must
wait for the current run to finish.

### Queue Behavior

The upstream app-server is the reference for active-turn user input semantics. Graneri keeps the
same separation of responsibilities with its stack: AI SDK routes own the
stream/tool loop and acceptance headers, while Convex owns durable coordination,
atomic queue claims, lifecycle invariants, and replayable state. The target is
matching behavior, not identical storage.

| Reference behavior | Graneri implementation | Status |
| --- | --- | --- |
| One active turn owns in-flight user input. | `assistantRuns` enforces one non-terminal run per chat; duplicate active-run queries and queue claims fail closed with `ASSISTANT_RUN_INVARIANT_VIOLATION`. | Implemented |
| User input can be accepted during an active turn without trusting the client copy. | `/api/chat/steer` claims `assistantQueuedMessages` by id and reconstructs the user message from Convex before acceptance. | Implemented |
| Replay after a completed turn uses server-owned queued input. | `/api/chat` accepts only `replayQueuedMessageId`, loads the claimed row, saves the user message, and deletes the claim before starting a new run. | Implemented |
| Accepted input remains accepted even if later stream setup fails. | Replay and steer routes emit accepted headers and the web transport resolves post-accept failures as empty successful streams. | Implemented |
| Stale or wrong targeted input does not silently disappear. | Targeted queue claims throw Convex errors for missing rows, wrong run, inactive turns, existing claims, wrong chat, or wrong queue state. | Implemented |
| No queued assistant-run fallback exists. | Runs start directly as `running`; durable follow-ups live only in `assistantQueuedMessages`. | Implemented |
| Stale claimed input is not an invisible leftover. | Claim mutations requeue stale claimed rows before attempting the next claim; terminal run cleanup deletes queued and claimed rows for that run. | Implemented |
| Waiting-for-user input resumes the same turn. | `waiting_for_user` runs can claim and accept steered input, clear `pendingDecision`, append `turn.steer.accepted`, and continue without creating a second run. | Implemented |
| Pending input is local to a turn and can be drained into the next turn state. | Hosted active stream sessions expose `extendPendingInput`, `takePendingInput`, `hasPendingInput`, and `clearPendingInput`; running steer interruptions append the steered message, drain the active session, and feed ordered pending user messages into the next AI SDK prompt branch with message-id de-duplication against persisted history. | Implemented |
| Multiple active-turn inputs can accumulate before the model loop drains them. | Graneri can persist multiple queued follow-ups, the renderer accepts distinct manual steer intents into a FIFO while one steer request is in flight, `claimReadyForRun` claims the targeted row plus ready queued rows for the same active run, `acceptSteeredUserMessages` atomically saves/deletes the accepted batch, and active stream replacement carries ordered pending input until it is drained into the next prompt branch. | Implemented |
| Activity subscribers can distinguish mailbox work from steered input. | Hosted active stream sessions expose `subscribePendingInputActivity`; pending steered input reports `steer`, queued mailbox-style input reports `mailbox`, and subscribing after input is already pending returns the pending activity. | Implemented |
| A model tool can wait for mailbox or steer activity. | Graneri exposes a runtime-only AI SDK `wait_agent` tool. It subscribes to hosted active stream activity, wakes immediately on already-pending activity, returns app-server-compatible `{ message, timed_out }` results for mailbox, steer, and timeout, and aborts with the active turn. | Implemented |
| Mailbox delivery is accepted into turn state. | Hosted active stream sessions keep mailbox-style pending input separate from steered input, can defer mailbox delivery after an answer boundary, and reopen delivery when steered input arrives. Replacement sessions carry both steer and mailbox pending input forward. | Implemented |
| A model can create and manage live subagents. | Graneri does not expose subagent tools because the product does not have subagents. Runtime tools such as `spawn_agent`, `send_message`, `followup_task`, `list_agents`, and `interrupt_agent` are intentionally out of scope. | Not applicable |

The current queue, steering, replay, and run-lifecycle slice is close to the reference
for durable correctness and fail-closed behavior. Graneri keeps mailbox activity
and wait primitives for active-turn user input, but it does not implement
reference subagents. Graneri drains accepted input at the AI SDK stream restart
boundary into the next prompt branch, while Convex remains the durable source of
truth for user input, chat runs, crash recovery, and cross-process coordination.
Renderer chat interaction ownership is shared across workspace and note chat
surfaces. `use-chat-interaction-session.ts` owns request-preparation leases and
atomic optimistic message commit, rollback, and truncation;
`use-renderer-chat-session.ts` composes that state with AI SDK streaming,
durable queued follow-ups, and stop arbitration. Persisted/external/local stop
ordering enters through `chat-interaction-session.ts`. Chat surfaces provide
request-body and presentation adapters, but must not maintain parallel pending
or optimistic-message state.
Note-scoped discussion ownership is layered on top of the shared renderer
interaction session by `use-note-discussion-session.ts`. It owns draft/stored
chat identity, note chat list/session/run snapshots, prefetching, selector
grouping, title/loading derivation, and model/reasoning persistence. The note
composer owns only editor, attachment, transcript, focus, and panel-presentation
adapters; it must not reproduce discussion identity or query orchestration.

Connected app AI capabilities are declared in
`@workspace/ai/capability-metadata`. The catalog is the source of truth
for provider identity, source classification, connection and OAuth behavior,
settings identity, source instructions, remote defaults, and tool-discovery
prefixes. `@workspace/ai/capability-registry` attaches runtime-specific
tool adapters to every app-source capability and fails at module load when an
adapter is missing. Desktop-local capabilities such as shared local folders
and native transcription remain desktop bridge APIs, not generic connected-app
capabilities.
Renderer connection lifecycle is owned by
`apps/web/src/components/settings/use-connected-app-settings-session.ts`.
Provider views consume its stable connection snapshot and provider-family
sessions; they must not reimplement form reset, OAuth navigation, connection
failure cleanup, or workspace-scoped loading. Remote MCP providers enter through
`use-remote-mcp-connection-session.ts`, while capability identity and defaults
remain authoritative in `@workspace/ai/capability-metadata`.
Note transcript capture lifecycle is owned by
`apps/web/src/lib/note-transcript-capture-session.ts`. It serializes session
identity, concurrent starts, draft/server hydration precedence, queued and
deduplicated utterance persistence, capture-scope replacement, and system-audio
mode persistence claims. React effects in `use-note-transcript-session.ts`
adapt this lifecycle to route scope, Convex repositories, and desktop capture;
they must not recreate temporal ownership with parallel refs.

`convex/`
: Server functions, schema, HTTP actions, auth, and server-only integrations.
Read `convex/_generated/ai/guidelines.md` before changing Convex code. Convex
derives ownership from server-side identity; client arguments may select
resources such as workspace or chat ids, but they must not be trusted as owner
identity. `convex/domain.ts` owns the shared access-control primitives for
queries, mutations, and actions. Feature modules configure their resource label
through `createResourceAccess` and use the canonical workspace ownership guard;
they must not define local authentication or workspace ownership wrappers.
`convex/resourceRetirement.ts` owns permanent note and chat retirement policy:
bounded collection batches, progress reporting, idempotent retries, and
continuation scheduling for note-, workspace-, owner-, and trash-scoped
removal. Note and chat feature modules expose record-specific retirement
adapters, but callers must enter through the resource-retirement boundary and
must not reproduce record ordering or retry loops.
Automation execution state is owned by
`convex/automationRunStateMachine.ts`. Run reservation, activation, active-run
checks, terminal transitions, and chat-linked pause/resume/move consequences
must enter through that module. `convex/automationSchedule.ts` is the canonical
home for next-run calculation and scheduled-function registration; definition
CRUD may invoke it but must not reproduce schedule arithmetic or cancellation
behavior.
Hosted auth provider configuration is fail-closed: missing OAuth
provider credentials must reject configuration instead of substituting
placeholder client ids or secrets.

## Release Configuration

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

Official builds pass:

```sh
GRANERI_HOSTED_CONVEX_URL=https://<prod-deployment>.convex.cloud
GRANERI_HOSTED_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
GRANERI_HOSTED_SITE_URL=https://<hosted-app-origin>
```

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

## Desktop AI

The desktop local server owns the loopback HTTP boundary used by renderer
fetches and native capture:

- `/api/chat`
- `/api/chat/steer`
- `/api/chat/stop`
- `/api/chat/:chatId/stream`
- `/api/apply-template`
- `/api/enhance-note`
- `/api/realtime-transcription-session`
- `/api/dictation-transcription`

Hosted AI route identity, HTTP method, parameterized path matching/building,
and desktop proxy body mode are owned by
`@workspace/ai/hosted-route-catalog`. Vite middleware, Vercel wrappers,
renderer clients, and the desktop loopback proxy consume that catalog instead
of maintaining private endpoint lists. Handler wiring remains in the runtime
that owns the handler; the shared catalog contains transport metadata only.

Chat, note generation, template application, and realtime session creation are
transport-only proxies to the web server in every environment. Dictation
transcription crosses the authenticated Convex HTTP boundary directly. Local
folder tool execution remains inside the desktop process because it operates on
folders the user explicitly shared with the installed app.

Packaged desktop apps must not embed `OPENAI_API_KEY`, and the Electron process
must never consume it even when one exists in its local environment. During
development, the loopback server proxies hosted AI routes to the matching Vite
handlers at `SITE_URL`; production proxies those same routes to the Vercel
deployment at `GRANERI_HOSTED_SITE_URL`/`SITE_URL`. `.env.local` supplies the
OpenAI key only to the local web server handlers. Convex HTTP is not an AI SDK
streaming fallback; it remains the durable backend, auth/OAuth callback surface,
and state coordination layer. Release behavior must not depend on
terminal-inherited shell environment.
Hosted production deployments must expose the same AI HTTP routes as real
serverless functions under `/api/*`; Vite dev/preview middleware is only the
local development surface and is not a Vercel production route by itself.
Each model-producing hosted chat turn must pass through Convex admission before
Vercel starts or steers an AI SDK stream. Convex authenticates and rate-limits
the stable identity; Vercel hashes that identity and sends it as OpenAI's safety
identifier. Reconnect and stop-only requests do not consume chat admission.
Hosted note enhancement and template application follow the same boundary:
their renderer requests carry the current Convex bearer token, both routes
consume one shared per-identity `note-generation` admission bucket, and the web
handler sends only the hashed stable identity to OpenAI as its safety
identifier. Anonymous requests and unavailable admission fail closed before a
model request begins; there is no unauthenticated or client-key fallback.
`apps/web/server/hosted-openai-admission.ts` is the single web-server envelope
for chat, note generation, template application, and realtime session
admission. It owns operation-to-Convex authorization, rate-limit responses and
retry headers, server API-key enforcement, and the hashed safety identity
handoff. Route handlers report rejected admission to their wide event and own
only their request validation, model invocation, and response-specific stream
or payload behavior.
The OpenAI key and streaming/tool loop remain in the web server handler (Vite
locally and Vercel in production), while Convex continues to own authorization
and durable run, queue, message, and lifecycle state. Development and
production therefore execute the same chat implementation and identity
boundary.

Hosted chat consumers enter shared orchestration through
`@workspace/ai/hosted-chat-turn`. Active-stream persistence, branch
preparation, queued input, run start/finalization, and transport-event modules
are package internals; app and route code must not bind to their individual
file boundaries. Browser-safe request validation and acceptance-header helpers
remain isolated in `@workspace/ai/hosted-chat-runtime` so renderer bundles do
not traverse server-only orchestration dependencies. Bearer-token parsing is
the separate `@workspace/ai/hosted-chat-http` transport utility.

Local-folder chat uses a hosted-model, desktop-tool bridge:

1. The hosted web AI route owns the OpenAI key and model loop.
2. The hosted web AI route declares local folder tools without server-side executors.
3. The desktop renderer receives client-side local tool calls.
4. The renderer executes those calls through the desktop local server against
   folders explicitly shared through the desktop bridge.
5. The renderer attaches tool output and lets the AI SDK resubmit the
   conversation to hosted Convex.

Client-side local tool outputs must resubmit with the same chat request body,
including `localFolders`, so subsequent hosted model steps keep the same desktop
tool context. Durable queued replay and steer are the exception: queued request
state is stored in Convex and must reject non-empty `localFolders` rather than
persisting local filesystem selections.

Hosted handlers must never claim direct access to the user's Mac filesystem.
Desktop-local capabilities must fail visibly when the desktop bridge contract is
unavailable. Local path references must be registered through
`shareLocalFolders` before they reach `/api/chat`, or request preparation must
fail with an actionable error.

On macOS, live transcription must use the desktop transcription controller. It
must not silently fall back to the browser transcription controller when the
packaged desktop bridge is missing or stale.

Global dictation is a desktop-native capability, not a renderer textarea
feature. The desktop runtime owns the global hotkey monitor, microphone capture,
buffered AI SDK transcription, and system paste into the focused app. Renderer
code must not duplicate dictation capture or expose route-level fallbacks for
this path. The renderer may select the persisted global dictation hotkey mode
through the desktop bridge; Electron applies hold, toggle, or disabled mode by
restarting the native hotkey monitor without restarting the app.
Global dictation sends at most 19 MB of temporary WAV audio through the
authenticated desktop local-server route to one Convex HTTP action. That action
rate-limits the authenticated identity, stores the audio, schedules an
idempotent expiry before invoking the internal OpenAI transcription action, and
attempts immediate deletion when the request finishes. The scheduled cleanup is
the durable guarantee when a request or action is interrupted. There is no
client-visible generated-upload or registration lifecycle. The OpenAI request
uses the same SHA-256 safety identifier policy as realtime transcription.

Desktop realtime transcription obtains its short-lived OpenAI client secret
from the authenticated hosted Vercel route through the desktop local server.
The hosted route rate-limits the authenticated identity and sends OpenAI a
SHA-256 hash of the stable Convex token identifier as
`OpenAI-Safety-Identifier`; the raw identity never leaves Graneri's server
boundary. Realtime recovery is bounded to three reconnect attempts with 750 ms,
1.5 s, and 3 s backoff, and each attempt must request a fresh short-lived
secret. Electron must never call OpenAI with a long-lived API key or embed that
key in a build.
While a dictation capture is active, Electron owns a temporary global Escape
shortcut that cancels capture and discards buffered audio without transcribing
or pasting it. The idle dictation bar is suppressed when dictation hotkeys are
disabled, even if its persisted visibility preference remains enabled.

Desktop realtime transcription is a long-lived native capture session. Starting
the microphone transport must schedule the realtime session rollover, and
the native transport must explicitly commit non-empty OpenAI input audio
buffers during live capture. Empty-buffer commits are not a valid path; they
create recoverable-looking OpenAI errors that can collapse into start/stop
loops.

`desktop-transcription-runtime.mjs` owns the per-speaker transport state, live
transcript projection, ordered turn emission, interrupted-tail salvage, and
initial renderer session shape. Electron `main.mjs` orchestrates permissions,
native capture, reconnects, and IPC around that runtime; it must not maintain a
second set of speaker turn maps or interpret realtime transport events itself.

Packaged renderer documents are served with a Content Security Policy. Network
connections are limited to the configured Convex and hosted-site origins,
their WebSocket equivalents, the desktop loopback API, and the explicit OpenAI
and GitHub endpoints used by renderer capabilities. Inline scripts are not
allowed; the pre-render theme initializer is a packaged static asset.

Desktop meeting audio must preserve two distinct sources: microphone audio is
the `you` source, and native system audio is the `them` source. Built-in speaker
routes may need echo/leakage suppression so remote speech does not bleed into
the microphone stream and get labeled as `you`, but that suppression must not
duck or lower the user's meeting audio. Headphone routes should not enable
microphone voice-processing or echo-cancellation paths because there is no
speaker playback to suppress. The target architecture is a combined native
capture pipeline: capture microphone and system audio with synchronized timing,
use system audio as the echo-cancellation render/reference for the microphone
stream, emit cleaned microphone audio as `you`, and emit raw system audio as
`them`. Apple voice processing is a route-scoped stopgap, not the long-term
source-separation mechanism.
The combined helper must disable Apple microphone voice processing and own echo
reduction itself, because Apple processing can alter the user's local meeting
volume and obscure which source caused attenuation.

Native audio helpers communicate with Electron over newline-delimited JSON.
`ready`, `chunk`, `error`, and `stopped` are the only helper event families.
Separate microphone and system-audio helpers infer source from the process that
emitted the event. A combined helper must emit the same `chunk` shape plus a
`source` field set to `microphone` or `systemAudio`, allowing Electron to keep
the speaker contract stable while the native process owns synchronized capture
and echo-cancellation reference timing. The combined helper binary is the
native integration point for echo reduction. Its microphone path must flow
through the combined audio processing pipeline, and that pipeline must use
system audio as the render/reference signal before microphone audio is emitted.
Echo reduction must be correlation-gated: active system audio alone is not a
reason to subtract from the microphone stream, because local-only speech during
remote playback must pass through unchanged. After AEC3 runs, the microphone
path applies one source-attribution gate: if system audio is active and the
post-AEC microphone energy is below the local-speech floor, that residual is
silenced before it can be emitted as `you`. Double-talk above that floor must
remain in the microphone stream.
The combined helper's ready event must report the audio processing stage so
diagnostics can tell whether microphone output is waiting for render reference
or actively reducing echo.
`bun --filter=desktop run diagnose:meeting-audio -- --play-system-sound` is the
local smoke test for this boundary. It starts the combined helper, plays a short
system sound, and reports only route metadata, source chunk counts, and bounded
processing diagnostics. It must not print or persist raw PCM.

Meeting-controlled and idle-controlled automatic stops must be modeled as
explicit transcription auto-stop state in the renderer, not scattered hook
refs. A newly auto-started note must not inherit stale meeting-detection state
from a previous note or from a pre-listening meeting signal.

Desktop meeting detection owns its signal inputs in Electron. Calendar
candidate selection, native microphone activity clients, source normalization,
debounce, dismissal, suppression, and widget window visibility stay in
`apps/desktop`; the renderer receives an aggregate meeting-detection state and
may render it or send user actions back through `packages/platform`. Renderer
code must not inspect running applications, microphone activity, calendar state,
or desktop windows directly to decide whether a meeting exists.
Meeting prompts and scheduled calendar reminders intentionally use a
desktop-owned custom notification-like window rather than OS notification
delivery. On macOS this surface must be a panel-style window hidden from Mission
Control, kept out of the task switcher, and visible across spaces/full-screen
contexts. The custom surface is part of the desktop meeting state machine:
Electron owns prompt debounce, scheduled-reminder de-duplication, dismissal,
suppression, full-screen/workspace visibility, and action handling so the prompt
remains predictable under Focus modes, Notification Center settings, and
transcription state changes.

Proxy response handling must match the body strategy. Streamed routes may pipe
the upstream body with upstream headers. Buffered or decoded proxy responses
must emit fresh body headers and must not forward stale `content-encoding`,
`content-length`, or `transfer-encoding`.

## Desktop Runtime

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

Desktop app lifecycle sequencing is owned by
`apps/desktop/src/desktop-boot-orchestrator.mjs`. The Electron main module may
compose concrete adapters, but lifecycle ordering for single-instance handling,
ready startup, suspend handling, window-all-closed cleanup, and before-quit
cleanup must stay behind the boot orchestrator interface.

Desktop diagnostics are owned by Electron in
`apps/desktop/src/desktop-diagnostics.mjs`. The native Help menu may start a
bounded Chromium performance trace, toggle a macOS unified-log stream, and open
the dedicated `userData/troubleshooting-logs` directory. Structured desktop
events are persisted asynchronously to a size-rotated
`troubleshooting-logs/graneri.log`. `desktop-diagnostics-paths.mjs` is the single
owner of these filesystem locations. Diagnostic streams, active traces, local
services, and the file logger must finish through the awaited boot-orchestrator
shutdown path before Electron is allowed to quit.

Electron Builder packages dependencies from `apps/desktop/package.json`.
`@workspace/ai` is a direct desktop dependency because desktop main-process
code consumes its public modules. Any third-party package imported by packaged
desktop runtime code through `apps/desktop`, `packages/ai`, or copied runtime
modules must also be declared there.

The desktop build packages generated runtime artifacts only. Packaged Electron
main code lives in `dist-electron/main/index.js`, and packaged renderer assets
live in `dist-app`. Packaged windows load renderer assets through `app://ui`.
Packaged runtime code must not rely on source-tree imports. JavaScript runtime
dependencies belong in the main-process bundle. The only packaged
`node_modules` exception is a native module that cannot be bundled: it must be
declared as a platform-specific optional dependency, staged explicitly with its
runtime dependencies, and covered by the package contract and verifier.

The generated package shape is owned by
`apps/desktop/scripts/desktop-package-contract.mjs`. Build scripts, Electron
Builder config, and package verification must read package paths and ASAR
rules from that module instead of repeating release layout strings.

Renderer route ownership lives in `packages/platform/src/renderer-routes.mjs`.
The packaged desktop protocol must use that manifest to decide whether an
`app://ui` pathname is a renderer route. Desktop protocol code must not carry a
private duplicate list of renderer route prefixes.

The desktop local server keeps Node HTTP transport and route dispatch in
`apps/desktop/src/local-server.mjs`. Reusable HTTP/CORS behavior, hosted AI
proxying, realtime transcription session creation, and local folder tool
execution live behind dedicated local-server modules. Electron contains no
model, response, lifecycle, or AI SDK implementation; the loopback server
preserves hosted request and response semantics. Shared hosted chat helpers own
prompt construction, run-plan assembly, tool-loop setup, branch preparation,
save payloads, active-stream persistence, and stream finalization mechanics.

Desktop packages must keep the app runtime in `Contents/Resources/app.asar`.
Only native helpers and bundled media tools may be unpacked into
`Contents/Resources/app.asar.unpacked` through targeted `asarUnpack` rules.
Runtime helper resolution must prefer the unpacked mirror before development
helper paths. Electron currently emits a terminal-only Node `DEP0180` warning
from its internal ASAR filesystem adapter (`electron/electron#47390`); do not
disable ASAR or add app-level suppression for that upstream warning.

Desktop auth cookies persist in an explicit JSON store under Electron's
`userData` directory with owner-only file permissions. Packaged OSS builds must
not use Electron Safe Storage, macOS Keychain, or another OS credential prompt
for routine session-cookie persistence. Renderer windows must not use Electron's
default persistent Chromium profile as an auth store; desktop auth state belongs
to the IPC auth bridge and desktop auth cookie store. Desktop startup must pass
Chromium's mock-keychain switch before renderer windows are created so Chromium
storage never opens the macOS Keychain prompt.

## Required Verification

After building the desktop package, run:

```sh
bun --filter=desktop run verify:package
```

The verifier must fail if:

- The packaged `Contents/Resources/app` runtime contains a stale development
  Convex deployment.
- The packaged `Contents/Resources/app` runtime misses the expected hosted
  Convex deployment.
- The bundled renderer contains stale dev Vite constants.
- Packaged runtime code imports Convex server TypeScript.
- Bare package imports in `dist-electron` cannot resolve from packaged
  `node_modules`.
- Required native runtime helpers are missing, or the combined audio helper
  fails its AEC3 self-test, including residual-leak gating for active system
  audio.

## Enforcement

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.
Desktop realtime transcription changes must include the desktop transport tests
for stop-flush behavior, native audio tests for combined-helper AEC3 behavior,
and renderer auto-stop tests for meeting/idle state.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
