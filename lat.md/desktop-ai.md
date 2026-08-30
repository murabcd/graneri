# Desktop AI

Desktop AI modules preserve hosted model ownership while routing authenticated transport and explicitly shared local capabilities through Electron.

- [[assistant-runs]] owns shared hosted execution.
- [[transcription]] owns dictation and realtime capture.
- [hosted route catalog](../packages/ai/src/hosted-route-catalog.mjs)
- [local workspace session](../packages/ai/src/local-workspace-session.mjs)
- [desktop local-folder picker](../apps/desktop/src/desktop-local-folder-picker.mjs)
- [local capability session](../apps/desktop/src/local-capability-session.mjs)

## Loopback routes

The desktop local server exposes a fixed authenticated loopback route surface for chat, generation, transcription, and local tools.

The desktop local server owns the loopback HTTP boundary used by renderer
fetches and native capture:

- `/api/chat`
- `/api/chat/steer`
- `/api/chat/stop`
- `/api/chat/:chatId/stream`
- `/api/apply-template`
- `/api/enhance-note`
- `/api/generate-project-description`
- `/api/realtime-transcription-session`
- `/api/dictation-transcription`

## Hosted route catalog

One shared catalog owns hosted route identity, methods, parameterized paths, and desktop proxy body strategies.

Hosted AI route identity, HTTP method, parameterized path matching/building,
and desktop proxy body mode are owned by
`@workspace/ai/hosted-route-catalog`. Vite middleware, Vercel wrappers,
renderer clients, and the desktop loopback proxy consume that catalog instead
of maintaining private endpoint lists. Handler wiring remains in the runtime
that owns the handler; the shared catalog contains transport metadata only.

## Proxy and local ownership

Hosted generation stays on the web or Convex, dictation crosses Convex HTTP, and local-folder execution stays inside Electron.

Chat, note generation, project description generation, template application,
and realtime session creation are transport-only proxies to the web server in
every environment. Dictation
transcription crosses the authenticated Convex HTTP boundary directly. Local
folder tool execution remains inside the desktop process because it operates on
folders the user explicitly shared with the installed app.

## Hosted configuration and admission

Packaged apps contain no OpenAI key, and every paid hosted operation crosses authenticated, rate-limited Convex admission.

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
the hosted route starts or continues paid AI SDK work. Convex authenticates and
rate-limits the stable identity; the active producer hashes that identity and
sends it as OpenAI's safety identifier. Chat admission also issues a
short-lived, identity-bound reservation
that exactly one Convex producer start or continuation mutation must consume
before scheduling paid background work. Used and expired reservations cannot be
replayed. Reconnect and stop-only requests do not consume chat admission.
Hosted note enhancement, project description generation, and template
application follow the same boundary: their renderer requests carry the current
Convex bearer token, all three routes consume one shared per-identity
`note-generation` admission bucket, and the web handler sends only the hashed
stable identity to OpenAI as its safety identifier. Anonymous requests and
unavailable admission fail closed before a model request begins; there is no
unauthenticated or client-key fallback.

## Hosted OpenAI envelope

One web envelope owns admission and safety identity, while durable Convex actions own normal model loops and desktop-local turns remain web-owned.

`apps/web/server/hosted-openai-admission.ts` is the single web-server envelope
for chat, note generation, project description generation, template
application, and realtime session admission. It owns operation-to-Convex
authorization, rate-limit responses and retry headers, conditional web-server
API-key enforcement, and the hashed safety identity handoff. Normal
Convex-produced chat turns do not require an OpenAI key in Vercel;
desktop-local web producers, note generation, project description generation,
templates, and realtime session creation still do.
Route handlers report rejected
admission to their wide event and own their request validation plus
response-specific handoff, stream, or payload behavior.
The OpenAI key and normal hosted streaming/tool loop run in the Convex internal
action so a Vercel request lifetime is not the turn lifetime. The web handler
retains request validation, context construction, branch preparation, user
message persistence, acceptance headers, and the durable start handoff. Convex
owns authorization plus run, queue, message, stream-snapshot, tool, and
lifecycle state. Vite-local and hosted production requests use this same
boundary. The only web-owned model loop is a turn with desktop-local folder
scope, because its tool calls must cross back through the live renderer and
desktop loopback server.

## Shared hosted interface

Consumers enter through intention-level package interfaces without binding to private orchestration files or server-only dependencies.

Hosted chat consumers enter shared orchestration through
`@workspace/ai/hosted-chat-turn`. Active-stream persistence, branch
preparation, queued input, run start/finalization, and transport-event modules
are package internals; app and route code must not bind to their individual
file boundaries. Browser-safe request validation and acceptance-header helpers
remain isolated in `@workspace/ai/hosted-chat-runtime` so renderer bundles do
not traverse server-only orchestration dependencies. The turn interface does
not re-export those request helpers; server consumers import each interface by
its runtime responsibility. Bearer-token parsing is
the separate `@workspace/ai/hosted-chat-http` transport utility.

## Local capability session

Electron owns durable local authorization and idempotent execution while hosted and Convex state carry only an opaque descriptor.

Local-folder chat uses a hosted-model, desktop-tool bridge:

1. Electron authorizes one canonical root for a renderer scope and persists its
   path behind a random capability id.
2. The renderer, hosted web route, durable queue, and Convex run store only the
   strict `{ id, label }` descriptor; local paths never cross IPC responses or
   enter hosted/Convex state.
3. The hosted web AI route owns the OpenAI key and declares local tools without
   server-side executors.
4. The desktop renderer receives client-side calls and sends the capability id,
   tool-call id, input, and upload URLs to the authenticated loopback route.
5. Electron resolves the id to its private root, validates the tool input, and
   executes it through the shared-root workspace adapter.
6. The renderer attaches the output with the same run id and run-bound
   capability descriptor so the hosted producer continues one canonical turn.

`apps/desktop/src/local-capability-session.mjs` is the deep native module for
authorization, revocation, durable path ownership, and execution receipts.
Receipts bind one tool-call id to the hash of its capability, tool, and input.
Completed calls return their stored output across renderer or application
restarts. Receipts remain for the lifetime of the capability rather than using
a count-based eviction policy that could permit an old continuation to execute
twice. An execution that reached `started` without a durable result is never
repeated after restart; it fails explicitly so future native tools cannot apply
one action twice. Replacing or revoking a scope removes its mapping before any
later request can resolve it and deletes its receipts. The module does not run
while Graneri is completely quit; background-daemon execution is a separate
product capability.

Convex binds the descriptor to `assistantRuns` and projects pending local calls
from durable `chatToolCalls`. On renderer reattachment, the shared recovery
module executes each pending call through Electron and continues the original
run. The renderer and reconnect route do not attempt HTTP stream attachment or
orphan cleanup while a pending local call is waiting for its desktop executor.
Every continuation must present exactly the descriptor bound at run creation;
neither adding a capability to a capability-free run nor omitting a run-bound
capability is allowed.
Durable queued follow-ups may retain the opaque descriptor because it carries no
path and Electron revalidates the capability at execution time.
The shared local-folder tool contract owns tool names and completed-output
validation across the renderer, hosted route, and Convex. A desktop tool
continuation is an assistant message, not an empty user input or an edited
branch: the hosted route reconstructs it against the stored pending assistant
message, Convex atomically replaces only the matching tool output fields, and
the next hosted turn must not persist the preceding user message again. Every
model step in that AI SDK client-tool loop reuses the same assistant message id,
so accumulated tool parts replace one canonical Convex message instead of
creating overlapping assistant-message copies.
If one AI SDK step contains both a completed desktop-local tool and a tool
approval response, request preparation must compose both strict canonicalizers
against the same stored assistant message so neither client-controlled copy of
the original tool input is trusted and neither continuation result is dropped.
The local-folder tool definition catalog is authoritative for each tool's name,
input validation, model-facing description, multimodal output conversion, and
UI metadata. Hosted declarations, continuation recognition, desktop executor
attachment, and tool presentation derive from that catalog; adding a local tool
must not require another parallel name or metadata registry.
`createLocalWorkspaceSession` remains the canonical owner of shared-root validation,
root lookup, symlink-safe containment, no-follow file access, traversal limits,
ignored-directory policy, and media-aware local search. Shared roots are
canonical real paths, one chat may expose one root, and an
invalid or stale root fails the request visibly instead of being dropped. The
AI SDK tool builder is only an adapter over this workspace interface and the
desktop file-storage and command capabilities. `read_local_file` has one
automatic, signature-based input path: it returns explicit byte ranges for
UTF-8 text and model file content for supported images, PDF, DOCX, XLSX, and
PPTX. OOXML packages are classified from their ZIP entry names, not their file
extensions or caller-provided MIME types. There is no content-mode argument or
format-specific read tool. `search_local_files` similarly owns both
filename/text-content search and bounded image discovery. Image searches and
non-text reads keep discovery and byte access in Electron, then use
authenticated Convex upload URLs to cross the hosted boundary. Their client
tool outputs contain storage-backed file references, and the hosted AI SDK tool
declaration converts those references into model file content for the next chat
step. Electron neither constructs an OpenAI model nor consumes an OpenAI key.
Chat attachment reference tracking owns those temporary file bytes until the
last referencing chat message is removed.

## Attachments and local commands

Signature-based files and a bounded virtual Bash environment reach the model without native command execution or network access.

Chat composer attachments use the same browser-safe signature detector before
requesting storage. The detector, rather than the browser-declared MIME type,
owns the canonical media type and accepts UTF-8 text, supported images, PDF,
DOCX, XLSX, and PPTX up to the model file limit. Unsupported binary files and
generic ZIP archives fail before upload. Both direct attachments and local-file
tool results reach the hosted OpenAI Responses model as URL-backed AI SDK file
parts; no renderer or Electron process parses document contents itself.
`run_local_command` executes one cross-platform virtual Bash environment from a
selected root. The Electron main process creates a fresh `just-bash` `OverlayFs`
environment for every call and executes the command directly; the shared AI
package is the only owner of the model-facing AI SDK tool and receives desktop
execution only through an explicit adapter. The adapter returns only exit code,
standard output, standard error, and truncation state; the shared local-folder
contract validates that semantic
result and keeps the command input, canonical root, and sandbox implementation
private to Electron. Reads reflect the live selected root, while writes exist
only in the call's bounded copy-on-write layer and are discarded afterward.
The overlay blocks reads outside the root and rejects symlink traversal. The
shell exposes
the bounded `just-bash` tool catalog, sandboxed QuickJS and WASM CPython. It
exposes neither network access nor native host executables. Command length,
execution, traversal, file reads, virtual writes, and captured output are
bounded. The optional `just-bash` host-global defense monkey patches must
remain disabled because Electron main owns unrelated timers and process state;
the capability boundary, virtual filesystem, worker runtimes, and explicit
limits are the isolation layers. There is no native OS command runner or
unsandboxed fallback.

## Desktop-local availability

Desktop-only capabilities require the real bridge and one scope-aware local capability session; unavailable, revoked, or stale state fails visibly.

Hosted handlers must never claim direct access to the user's Mac filesystem.
Desktop-local capabilities must fail visibly when the desktop bridge contract is
unavailable. Local path references must be registered through
`authorizeLocalCapabilitySession` before they reach `/api/chat`, or request
preparation must fail with an actionable error.
Renderer chat surfaces use `useLocalCapabilitySession` as the scope-aware
adapter over Electron authorization, selection, revocation, and descriptor
loading. The renderer does not persist paths or duplicate native capability
state. A late load result must never replace newer request state or expose the
descriptor from the previously active chat scope.
[[apps/web/src/lib/chat-request-preparation.ts]] owns the two explicit sources
for a request's local capability: authorize references from a new message, or
reuse an already-authorized opaque session for continuation. Workspace and note
chat callers use the same request builder for both sources. The existing
[[apps/web/src/hooks/use-renderer-chat-session.ts]] seam owns continuation
request preparation and pending local-tool recovery so chat surfaces cannot
install divergent recovery effects or supply a different continuation policy to
regeneration and human-decision flows.
In the desktop Ask AI composer, `Add local folder` opens the native single-directory
picker and registers the selected root through that same session. The active
root appears beside the Web and Plan controls as a removable folder chip. The
picker or a local path referenced in a later message replaces the active root.
The browser composer does not expose the picker, and browser requests report the
native capability as unavailable. Neither picker state nor local paths cross
into Convex chat settings or durable queued input; queued input stores only an
opaque run-replay descriptor. A Graneri
cloud project may be selected beside this control, but it is a separate durable
relationship used for project-owned resources; it does not grant filesystem
access and cannot replace the Electron-owned local-folder capability.

## Proxy response integrity

Proxy headers must match streamed, buffered, or decoded body handling.

Proxy response handling must match the body strategy. Streamed routes may pipe
the upstream body with upstream headers. Buffered or decoded proxy responses
must emit fresh body headers and must not forward stale `content-encoding`,
`content-length`, or `transfer-encoding`.
