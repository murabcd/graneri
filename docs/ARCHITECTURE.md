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
draft ordering with local effects and refs. Persisted note content has one
fail-closed format: canonical Tiptap document JSON. Markdown paste, import, and
chat-response capture are explicit ingestion paths that convert to that format
before saving; stored-content readers do not repair Markdown, malformed JSON,
unowned images, or legacy document shapes.
The note editor's `/` command menu uses Tiptap's open-source suggestion,
list/task, table, horizontal-rule, and image extensions for block styling and
insertion. Image picker, paste, and drop behavior also use the open-source
file-handler extension. Authenticated binary upload
goes directly to the Convex `/api/note-images` HTTP action; there is no Tiptap
cloud or Vercel Blob storage path. The Tiptap node persists both its display URL
and the canonical `noteImageId`, plus display-only alignment, caption, and width
attributes. Graneri owns the free image toolbar and caption node view; Tiptap's
open-source resizable node view owns drag geometry. Image replacement reuses the
same Convex uploader and updates the selected node in place, while the normal
note document session remains the only writer of note content.
`apps/web/src/lib/note-table.ts` is the single table-interaction module. It owns
rendered table geometry, edge-control visibility and drag reversal, column
resize normalization, menu-target lifecycles, selection preservation, and
row/column move and duplication semantics. The Tiptap node view and React menu
portal are rendering adapters over that module; they must not establish
parallel document listeners, hover timers, geometry models, or command paths.
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
The calendar page reads and creates events and provider calendars through
authenticated Convex actions. Provider credentials and write requests remain
server-side. `calendarProviderModule` owns provider selection, parallel
complete-snapshot aggregation, deduplication, provider-neutral command
normalization, and write dispatch; public Convex actions remain authenticated
adapters, while Google and Yandex implementations own their credentials and
wire protocols. Google event creation uses the calendar event scope; real
secondary calendar creation, metadata changes, and owned-secondary deletion
use the calendar-management scope, while calendar-list color/alias changes
and subscription removal use the calendar-list scope. Yandex creates
event-only collections with CalDAV MKCALENDAR and writes VEVENT resources with
CalDAV PUT. Calendar sources expose server-derived edit and removal
capabilities. Google primary calendars are editable but not removable, owned
secondary calendars are deleted, and non-owned entries are removed from the
user's CalendarList. Yandex default collections are editable but not deletable;
other writable collections with property-write access are removable. Yandex's
CalDAV service does not consistently expose the parent `unbind` privilege even
when the authenticated user can delete those collections, so the provider
DELETE remains the authoritative removal check. Destructive calendar deletion
requires another writable calendar on the same provider. Graneri preflights the
source, moves all resources, and deletes the provider calendar only after the
moves complete; Google subscription removal does not move or delete the owner's
events. Provider-default calendar
changes remain unsupported for Google because it does not expose a primary
calendar switch. Yandex exposes its real default through the RFC 6638
`schedule-default-calendar-URL` property on the scheduling inbox; Graneri reads
that property when building the source snapshot, updates it with CalDAV
PROPPATCH, and re-reads it before reporting success.
Event updates and deletes target the selected occurrence: Google
uses its instance event identifier, while Yandex writes an iCalendar
`RECURRENCE-ID` override or cancellation back to the original resource with
ETag protection. Event snapshots expose separate provider-derived full-edit,
guest-list, delete, attendee-removal, and calendar-move capabilities. Guest-list
permission is an explicit `none`, `invite`, or `manage` mode. Google
permits full editing for the organizer, creator, delegated non-primary calendar
writer, or an attendee
explicitly allowed to modify the event; delete-for-everyone is limited to the
organizer, creator, or delegated calendar writer. Yandex permits full event
changes for organizer-owned or organizerless personal events in a collection
whose CalDAV ACL includes write access. Google attendees may receive additive
invite permission without receiving full-edit or delete authority. Yandex
attendees with participant editing may manage the guest list without receiving
full event-edit or delete authority. `yandexCalendarEventAuthority` is the
single policy owner for both snapshot capability projection and refreshed write
authorization; parser and transport code provide provider facts without
reinterpreting organizer or attendee rules. Every mutation reloads the provider
event and rechecks that authorization server-side; renderer capability flags
are presentation data, not trusted authorization. Google invite-only requests
retain all existing participants. Yandex guest-management requests preserve the
current attendee's membership while applying the requested guest set. Both
ignore client-supplied changes to the event title, description, time, and
location.
Guest edits preserve retained provider attendee metadata such as response
state, and provider writes notify guests. Cancellation-for-everyone, attendee
removal, guest-list management, and calendar moves are distinct provider
operations and capabilities. Google
attendees remove their own event copy, while Yandex attendees decline the whole
invitation with CalDAV scheduling headers or decline one recurring occurrence
with an `EXDATE`; neither operation cancels the organizer's event. Organizer
calendar moves are limited to writable calendars on the same provider. Google
uses `events.move` and therefore applies Google's organizer-transfer semantics;
Yandex moves the VEVENT resource between writable CalDAV collections. Moving a
recurring event moves the whole series, even when the editor was opened from one
occurrence. Google default events with at most 200 attendees and Yandex
organizer-owned events expose move capability. Every move destination and every
attendee-removal request is re-authorized server-side. The renderer receives
explicit provider identity, opaque provider event identity, provider-owned
calendar color, per-calendar write capability, separate edit, guest permission,
cancel, remove, and move capabilities, and normalized recurrence identities; it
offers only same-provider writable destination calendars while editing.
New-event creation supports daily, weekly, monthly, and yearly recurrence with
an interval, explicit weekly weekdays, and never/on-date end
conditions. The renderer sends the user's IANA time zone with that normalized
recurrence contract. The server canonicalizes the zone, validates numeric and
date bounds, orders weekly days, and provider adapters serialize one standard
RRULE so Google and Yandex preserve the intended local wall time through
daylight-saving changes. Recurrence controls are intentionally absent from
occurrence-scoped editing until whole-series recurrence editing has a separate
provider contract.
Provider reads are complete-snapshot operations: a
failed calendar read rejects the refresh instead of caching a partial agenda,
so the renderer retains the last successful snapshot while provider reads and
writes refresh. `calendarSnapshotModule` is the renderer authority for
workspace-scoped Calendar Snapshot persistence, request coalescing, provider
source changes, and generation-fenced invalidation. Agenda windows and Home-day
windows remain distinct Calendar Scopes inside that module; Agenda, Home, and
the desktop tray consume projections of those snapshots instead of maintaining
parallel caches or optimistic event copies. Successful writes invalidate every
persisted snapshot for the workspace, retain the currently rendered complete
snapshot during refresh, and discard responses from older generations. Detail
updates followed by a calendar move are necessarily sequential provider calls;
update attempts invalidate snapshots even on failure so a completed first call
is never hidden behind stale renderer state.
Adjacent Agenda windows are prefetched through the same lifecycle.
Calendar provider adapters also return a normalized attendee snapshot for every
event: canonical lowercase email, display name, organizer/self flags, and
response status. Repeated iCalendar `ATTENDEE` properties must remain distinct
through parsing before normalization. Creating a calendar-linked note is one
Convex transaction that stores the immutable event/attendee snapshot, resolves
workspace-scoped people by email, resolves companies by non-personal business
email domain, and creates the note-to-person and note-to-company associations.
`companyDomain` owns canonical Company creation, domain-aware search, and
orphan cleanup; note relationships own atomic association persistence, while
meeting search owns result composition.
Archiving mirrors state onto those associations for indexed reads; permanent
deletion removes the associations and any now-orphaned canonical identities.
An invalid attendee or an event above the supported attendee bound rejects the
whole note creation instead of persisting a partial relationship snapshot.

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
The read-only `search_meeting_notes` tool is part of every authenticated workspace
tool set, independent of connected-app selection. Both web and durable Convex
producers call the same owner/workspace-checked relationship query, which reads
only non-archived calendar-linked notes through person/company association
indexes and returns bounded note text plus event schedule details. Its name and
description deliberately reserve it for stored meeting knowledge. When apps are
enabled, interactive chat builds its deferred tool catalog from every connected
and enabled workspace app; a source mention adds provider-specific prompt
guidance but never narrows that catalog. OpenAI Tool Search decides which
deferred tools to load, using the capability registry's provider namespaces.
When apps are disabled, no connected-app tool enters the run. Calendar
capabilities own current and future schedules, including attendee-name lookups.
Automations retain an explicit selected-source scope: they may use only the app
connections stored on that automation rather than every connection in the
workspace.

The workspace tool catalog is the canonical policy and assembly boundary for
both hosted-web and Convex-produced tool sets. It owns inventory deduplication,
failure isolation, available-versus-selected scope, source guidance, meeting
tool inclusion, and capability assembly; web and Convex supply narrow
runtime-specific adapters. The hosted web runtime loads only sanitized source
descriptors. Remote MCP and Yandex Tracker discovery and execution cross back
through authenticated public Convex actions that validate ownership and return
only tool inventories or tool results; those actions are rate-limited per
authenticated principal and resolve or refresh the credential-bearing
connection through internal Convex functions. Raw OAuth tokens, API tokens,
passwords, and connection headers must never be returned by a public Convex
function. Durable Convex runs may use the same credentials directly through
internal functions without crossing a public boundary.
Connection inventory failures and individual
provider discovery failures are isolated so one unavailable app does not remove
healthy providers or prevent a non-tool answer. Remote MCP discovery runs in
parallel, has a bounded timeout and inventory size, and uses a bounded
short-lived process cache;
tool execution still reconnects with server-held credentials and never moves
tokens into model context or durable Assistant Run jobs. Interactive durable
runs retain only the authenticated Better Auth user id alongside the job. A
Convex action uses that trusted server-side identity to request the user's
current Google token from Better Auth when a Google tool is enabled; the token
itself remains outside job state. Automations do not inherit an interactive
user identity and remain restricted to their explicitly selected server-owned
connections.
The route-facing hosted Assistant Run interface exposes intention-level preparation:
`createHostedChatTurnInput` couples the durable Follow-up adapter to its turn
controller, while `prepareHostedAssistantRunInput` owns branch resolution,
rolling context compaction, final Stored UI Message tail assembly, and AI SDK
message validation. Callers must not independently reconstruct either sequence
from private leaf modules.
The producer-neutral assistant execution module owns AI SDK agent construction,
stream creation, rich-message reconstruction, explicit streamed or consumed
delivery, tool-approval outcome detection, and completed/aborted outcome
classification. Convex imports this runtime-neutral module through
`@workspace/ai/hosted-assistant-execution`; it must not import the broader
hosted-turn interface because that graph includes web and desktop-local tool
implementations. Stored UI Message validation belongs to the UI message codec.
The Stored UI Message context projection is separately canonical: interactive
and automated Assistant Runs preserve text and stable completed-tool outcomes
through `stored-ui-message-context`, and rolling compaction renders the same
consequential content policy. Ephemeral parts and historical file references do
not cross that model-context boundary.
Web and Convex remain producer adapters: web owns desktop-local tool streaming
and HTTP delivery, while Convex owns liveness checks, durable snapshot cadence,
scheduling, and transactional finalization.
Turn input buffering is separate from active-stream transport: the hosted turn
input buffer owns pending steer/mailbox ordering, wait-agent activity
notifications, and mailbox deferral rules, while active-stream sessions own
broadcast, replay, abort, and persistence. Renderer stream pacing must propagate
downstream `ReadableStream` demand instead of draining frames into an already
full consumer queue. The web producer's broadcast also waits for every live
subscriber's positive `desiredSize` before reading or publishing another model
chunk; reconnect catch-up pauses the producer instead of creating a second
unbounded queue. Live reconnect history coalesces adjacent deltas for the same
stream part and is capped at 512 semantic chunks or 4 MiB, with at most four
simultaneous subscribers. Crossing a replay cap leaves the current live stream
running but rejects later replay subscriptions explicitly; it never falls back
to an incomplete protocol stream. The Node SSE writer waits for
`ServerResponse` drain and cancels its subscription when the socket closes; it
must not attach a fast tee consumer that bypasses response pressure.
The hosted chat route uses the shared user-message persistence helper for normal
saves, queued replay accepts, queued steer batch accepts, and continued-run
message appends; the route keeps HTTP telemetry and response formatting while
shared modules own chat behavior.
The hosted web chat route delegates active-run policy, same-run validation,
queued acceptance headers, assistant-run start, stream finalization, initial
AI SDK stream piping, and reconnect stream piping to its hosted stream runtime
module so HTTP parsing/context assembly stays separate from turn execution.
Long chat context is prepared through a durable rolling compaction checkpoint.
Ordinary input uses that context directly. Editing and regeneration first move
the replaced active suffix into its durable branch, clear the invalidated
checkpoint, and only then prepare the final Assistant Run input from the new
active history. Convex stores the authoritative summary boundary by
message ID and insertion time; the AI layer summarizes fixed oldest-first
batches and then sends the trusted summary through top-level AI SDK instructions
followed by the exact uncompacted user/assistant tail. Compaction never creates
or stores synthetic system messages, and it never deletes or rewrites saved chat
messages, so the user-visible transcript and future pagination retain complete
history. The shared chat-context policy owns the exact Assistant Run tail,
compaction batch size, and maximum compaction rounds as one coherent model-input
policy. Renderer snapshots and preserved replacement branches own independent
bounds; changing either operational limit must not silently alter compaction.
Automations deliberately use the same exact-tail policy because they assemble
the same checkpoint-backed model context. The checkpoint is private
context-assembly state; renderer code does
not infer compaction from it. When preparation discovers that compaction is
required, preparation first creates one owner-scoped, server-backed activity
through the web adapter, anchored to the triggering message. Ask AI and note
chat subscribe to that same bounded activity record through their shared
message renderer, show a
shimmering `Conversation compacting` activity while its status is `running`,
and replace that label in place with static `Conversation compacted` only when
the final checkpoint and completed activity commit atomically. Each checkpoint
mutation returns the next bounded preparation state, so multi-round compaction
does not reload that state through a separate query. Failed preparation removes
the matching running activity, lifecycle mutations are fenced by activity ID,
and an abandoned running activity expires automatically; a completed activity
remains until the next compaction replaces it or the chat history boundary
changes. Convex stores the checkpoint and its activity lifecycle as one
discriminated per-chat durable state record. `chatContextCompactions` alone owns
its lease, completion, cancellation, reset, and retirement transitions; branch,
automation, and chat-retirement modules use its intention-level helpers instead
of reading that record directly. Checkpoint updates use optimistic boundary
validation and must fail closed if another request changes the checkpoint while
a summary is being generated.
Editing a user message or regenerating an assistant response replaces the active
suffix without destroying it. Convex atomically moves the replaced active rows
into `chatBranches` and `chatBranchMessages`, retains their attachment storage
references, stops superseded run state, and clears the rolling context
compaction checkpoint and its current display activity before the new Assistant
Run input is prepared. Workspace chat and note chat use the same regeneration
session, which owns stop, request preparation, target-preserving regeneration,
and exactly-once preparation cleanup; callers own only presentation and error
display. The renderer reads active
history through cursor-paginated `chatThreads.readPage` pages and explicitly
offers older pages instead of silently truncating the transcript. Preserved
replacement branches remain durable recovery data. Separately, an assistant
message can be continued in a new immutable chat: Convex copies the bounded
prefix through that answer, records the source chat and message, leaves the
source unchanged, and visibly marks the fork when still-earlier ancestry could
not be copied. Graneri does not expose a switcher for preserved replacement
branches.
Web-produced assistant run start and active-stream session start share one
runtime helper so local-folder turns choose the same reject/supersede policy,
reuse matching continued runs, terminalize failed starts, and clean up
partially-created stream sessions. Convex-produced starts instead create the
run, snapshot, sanitized job, and scheduled action atomically in one mutation.
Hosted chat runs are durable Convex lifecycle records.
`assistantRunStateMachine` owns run creation, allowed transitions, ordered
lifecycle events, and mandatory queue/snapshot cleanup; `assistantRuns` exposes
the public Convex function adapters and lifecycle queries. Chat and queue modules
must cross the state-machine seam instead of patching `assistantRuns` rows.
`assistantQueuedMessageStateMachine` owns follow-up claim, stale-claim recovery,
acceptance validation, accepted-row deletion, and terminal cleanup. Acceptance
is one state-machine operation: it validates every claim, invokes the adapter's
transactional chat/run commit, and deletes the accepted rows only after that
commit succeeds. Public queue functions and chat persistence mutations are
adapters to that state machine and must not reproduce its transition rules.
Every run has an explicit `web` or `convex` producer owner. Reconnect may attach
only to `web` producers and must leave a running `convex` producer intact; stop
and terminal transitions remain shared durable state regardless of producer.
Starting a Convex-produced run is one mutation: it supersedes or rejects the
existing run, creates the active rich-message snapshot and sanitized job, and
starts a durable Convex Workflow atomically. Workflow owns the ordered turn
journal and uses its internal Workpool with at most ten concurrently executing
steps. Each retryable action performs exactly one AI SDK model/tool step with a
nine-minute timeout; Convex then checkpoints the complete message parts,
cumulative token usage, outcome, and next step index before Workflow advances.
A logical run may execute at most twenty model/tool steps across steering and
human-input continuations. There is no separate whole-turn watchdog.
The action derives ownership from the run, refreshes connected-app credentials
server-side, and rechecks generation-bound liveness before and after executable
tool side effects. Custom tool calls use durable logical-step receipts: a
completed retry reuses its stored result, changed input fails closed, and an
ambiguous side effect is never executed a second time. Workflow action retries
are explicit and bounded to three attempts with exponential backoff; mutation
steps retain Workflow's exactly-once semantics. The start mutation consumes the
single-use chat admission reservation and owns supported-model validation;
workflow arguments must never contain a user Convex token.
Normal hosted turns use this Convex producer. The web route authenticates and
prepares the canonical branch/context, persists the user input, starts the
durable job, and closes its SSE response; reactive Convex message and run
queries carry the live rich-message snapshot to workspace and note chat UIs.
Completed first turns terminalize before title generation begins, so optional
title work never keeps the composer in its active Stop state. A bounded title
input then flows through a separate retryable read-only Workflow step, and the
title mutation replaces only an untouched default title so a user rename always
wins.
`assistantRunJobs` retains only the sanitized model input, top-level AI SDK
instructions, and tool-selection configuration needed to resume the same
Convex producer after durable user input. Approval pauses save the assistant
approval message and checkpoint that message into the job. Accepting the
matching response atomically updates the checkpoint, clears the previous
temporary stream/tool rows, creates the next
assistant stream, and starts the continuation Workflow from the cumulative step
index. A previous Workflow may finish an already-running action after steering,
approval, stop, or cancellation, because component cancellation cannot stop an
in-progress action; generation fencing makes every stale snapshot, checkpoint,
tool receipt, completion, and failure harmless. Workflow completion performs
generation-bound failure handling and removes its component journal. Terminal
run cleanup and chat retirement must delete the job row and tool execution
receipts; access tokens and connected-app credentials must never enter them.
Convex-owned turns save generated-image artifacts directly through Convex File
Storage, so those files do not depend on the lifetime of the hosted HTTP
request.
Steering a Convex-owned turn atomically checkpoints any interrupted assistant
message into both chat history and the resumable job, appends the accepted user
message batch, rotates the assistant message id and active stream, and schedules
the next generation. Every action checkpoint is scoped to that message id so a
stale action cannot overwrite or fail the continued generation.
Together they enforce stop/failure/completion history and the
one-active-run-per-chat invariant. `chatActiveStreams` stores the latest complete
AI SDK message parts plus denormalized text, while active `chatToolCalls` stores
the auditable tool lifecycle. Text and message parts are coalesced into one
atomic snapshot update so reactive clients never observe a split producer
checkpoint. Both tables are temporary render snapshots scoped to a run;
terminal runs must leave no stream or active tool snapshots behind. These
records do not move desktop-local tool execution out of the
renderer/local-server bridge.
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
A web-produced client stream must not close as successful until completed-run
finalization has saved the assistant message, closed temporary stream/tool
snapshots, and terminalized the `assistantRuns` record. Finalization failures
are request failures, not background cleanup. A failed finalization attempt
must leave the same terminalization pending so a later flush can retry; it must
not poison the finalization queue with a permanently rejected in-flight
promise. A Convex-produced route response is only a durable-start handoff and
may close while the scheduled action continues.
Reconnect recovery follows the same no-leftover rule for `web` producers: when
a reconnect finds a running web run without a live in-process stream producer,
the route must mark the run stopping, attempt to save/delete the active stream
snapshot, and terminalize the run in a `finally` path. A `convex` producer is
already durable and must not be failed merely because no web process owns it. A
`waiting_for_user` run intentionally has no live stream producer and must remain
pending across reloads; both the renderer and reconnect route skip stream
attachment for that state. Snapshot cleanup failures may still surface to the
caller, but they must not leave the run blocking future queue drain or chat
sends. Manual stop uses the same shape: record durable stop intent before stream
cleanup, and terminalize in `finally` after cleanup is attempted.
Snapshots remain the live render surface; historical inspection, future missed
event replay, and debugging should use run events plus saved messages rather
than preserved snapshot rows.
AI SDK HTTP stream resume applies only to `web` producers and must attach to a
non-terminal `assistantRuns` record plus its live in-process producer. It must
not infer lifecycle from partial stream text. If Convex has an attachable web
run but the current process has no matching producer, the run fails and
temporary snapshots are cleaned up rather than returning a synthetic stream.
Convex producers resume through their durable job and reactive snapshot instead
of HTTP SSE attachment. Resume request preparation must fail when required
workspace or authentication state is unavailable; it must not fall back to the
normal chat send endpoint.
Human-blocking assistant work uses `waiting_for_user` plus a typed
`pendingDecision` on the run. Producers must resume the same run after the
decision instead of creating a second active run. Normal duplicate sends must
reject before persisting a new user message when a chat already has a
non-terminal run; clients must queue follow-ups against the active run.
Generic clarification uses the producer-neutral `request_user_input` tool. It
asks one focused question through the existing tool-row rendering and accepts
the answer through the normal chat composer; no separate question-form UI or
synthetic approval protocol exists. Both producers persist the exact assistant
message id, tool call id, and question as a `user_question` decision. Accepting
the next durable user message atomically verifies the stored request, converts
every pending question tool part in that assistant message to
`output-available`, appends the answer, records `input.resolved`, rotates the
assistant message generation, and resumes the same run. A normal user message
must not bypass a pending tool approval.
Tool approval uses the AI SDK v7 `toolApproval` protocol rather than
tool-specific confirmation payloads or synthetic user messages. The first
stream persists the assistant message in `approval-requested` state and moves the run to
`waiting_for_user` with a `tool_approval` decision. The response mutation must
atomically verify the approval id, assistant message id, tool call id, and tool
name, persist the `approval-responded` message, update the next assistant message
id, and resume that same run before a replacement stream starts.
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
The renderer and Convex parse that replay context through the single
`@workspace/ai/queued-chat-request` contract; neither side accepts an arbitrary
object container or maintains a parallel request-shape check.
Rich message JSON crosses storage and runtime boundaries only through
`@workspace/ai/ui-message-codec`. Strict consumers fail closed on malformed
parts, metadata, message arrays, and any stored role other than `user` or
`assistant`; historical model-input projection may skip malformed rows only
through the codec's explicitly tolerant helpers. The durable chat-message write
seam validates AI SDK message semantics and stores canonical rich parts JSON.
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
Any chat-level cleanup path that stops an active run, including active-branch
replacement and chat removal, must also append the stopped run event, delete live
snapshots, and discard both queued and claimed follow-ups for the stopped run.
Client cleanup mutations for individual queued or claimed rows must be scoped
by workspace and chat and must fail closed when the row belongs to another chat
or is in the wrong queue state; wrong-scope cleanup must preserve the row rather
than hide a stale client or cross-session bug.
Chat deletion must fail closed on invalid persisted attachment metadata or
storage ids, including attachment references retained by preserved branches;
cleanup must not silently skip malformed stored attachment references and
continue deleting surrounding chat state. Active and forked chat messages own
explicit attachment-reference rows, so deleting one chat releases only its
references and physical storage is removed only after the final referencing
chat is permanently retired. Branch replacement retains attachment references
until its owning chat is retired.
Otherwise stale claimed rows are requeued by Convex claim mutations before the
next claim attempt, because `claimed` represents an unaccepted in-flight
operation and must not become an invisible durable leftover after a client or
transport crash. Durable queued request state must not persist desktop-local
folder scope or absolute paths; follow-ups that need local-folder tools must
wait for the current run to finish.

### Queue Behavior

The upstream app-server is the reference for active-turn user input semantics.
Graneri keeps the same behavioral responsibilities with its stack: hosted HTTP
routes own validation, context preparation, persistence handoff, and acceptance
headers; Convex owns the normal hosted AI SDK loop, durable coordination, atomic
queue claims, lifecycle invariants, and replayable state. Desktop-local tools
remain the explicit exception because their AI SDK stream must return tool calls
to the installed renderer for execution. The target is matching behavior, not
identical storage.

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
| Destructive tools pause for durable user approval. | AI SDK approval parts are persisted on the assistant message; Convex stores a typed `tool_approval` decision, validates the matching response atomically, appends `input.resolved`, and resumes the same run. | Implemented |
| The assistant can ask for required clarification and continue the same turn. | `request_user_input` persists a typed `user_question`; the existing composer answer completes the stored tool call and resumes the matching web or Convex producer without UI redesign. | Implemented |
| Pending input is local to a turn and can be drained into the next turn state. | Hosted active stream sessions expose `extendPendingInput`, `takePendingInput`, `hasPendingInput`, and `clearPendingInput`; running steer interruptions append the steered message, drain the active session, and feed ordered pending user messages into the next AI SDK prompt branch with message-id de-duplication against persisted history. | Implemented |
| Multiple active-turn inputs can accumulate before the model loop drains them. | Graneri can persist multiple queued follow-ups, the renderer accepts distinct manual steer intents into a FIFO while one steer request is in flight, `claimReadyForRun` claims the targeted row plus ready queued rows for the same active run, `acceptSteeredUserMessages` atomically saves/deletes the accepted batch, and active stream replacement carries ordered pending input until it is drained into the next prompt branch. | Implemented |
| Activity subscribers can distinguish mailbox work from steered input. | Hosted active stream sessions expose `subscribePendingInputActivity`; pending steered input reports `steer`, queued mailbox-style input reports `mailbox`, and subscribing after input is already pending returns the pending activity. | Implemented |
| A model tool can wait for mailbox or steer activity. | Graneri exposes a runtime-only AI SDK `wait_agent` tool. It subscribes to hosted active stream activity, wakes immediately on already-pending activity, returns app-server-compatible `{ message, timed_out }` results for mailbox, steer, and timeout, and aborts with the active turn. | Implemented |
| Mailbox delivery is accepted into turn state. | Hosted active stream sessions keep mailbox-style pending input separate from steered input, can defer mailbox delivery after an answer boundary, and reopen delivery when steered input arrives. Replacement sessions carry both steer and mailbox pending input forward. | Implemented |
| Long visible history is explicit and recoverable. | The renderer subscribes to cursor-paginated newest-first Convex pages, prepends the active rich stream on the first page, and offers an explicit `Load earlier messages` action until the stored transcript is exhausted. | Implemented |
| An assistant answer can fork into a new chat without changing its source. | The `Fork chat` assistant message action creates an immutable fork through the selected stored answer, records its lineage, shares attachment lifetime safely, opens the new chat, marks it as forked, and separately discloses any ancestry omitted by the bounded copy. | Implemented |
| Editing or regeneration does not destroy the replaced history. | Convex archives the replaced active suffix and retains its attachment references before starting the replacement turn. A full thread-fork and branch-switching UI is not exposed yet. | Partial |
| A model can create and manage live subagents. | Graneri does not expose subagent tools because the product does not have subagents. Runtime tools such as `spawn_agent`, `send_message`, `followup_task`, `list_agents`, and `interrupt_agent` are intentionally out of scope. | Not applicable |

The current queue, steering, replay, and run-lifecycle slice is close to the reference
for durable correctness and fail-closed behavior. Graneri keeps mailbox activity
and wait primitives for active-turn user input, but it does not implement
reference subagents. Graneri drains accepted input at the AI SDK stream restart
boundary into the next prompt branch, while Convex remains the durable source of
truth for user input, chat runs, crash recovery, and cross-process coordination.
Renderer chat interaction ownership is shared across workspace and note chat
surfaces. `use-chat-interaction-session.ts` owns request-preparation leases and
atomic optimistic message commit, rollback, and active-branch replacement;
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
Convex File Storage is the sole owner of note image bytes. `noteImages` binds
each blob to its server-derived owner, workspace, and note; current documents
and retained `noteRevisions` hold explicit `noteImageReferences`. Every note
save enters through `convex/noteDocument.ts`, which parses and validates the
canonical document once, then supplies the same derived image references and
comment anchors to the transactional save. Malformed documents and invalid
table geometry fail before note state is changed. Every save validates image
ids and synchronizes the current reference set, revision
creation and pruning synchronize revision references, and permanent note
retirement removes all remaining bytes. An uploaded image that never reaches a
saved document is removed by its scheduled one-hour pending-upload cleanup.
Automation execution state is owned by
`convex/automationRunStateMachine.ts`. Run reservation, active-run checks,
terminal transitions, and chat-linked pause/resume/move consequences
must enter through that module. `convex/automationSchedule.ts` is the canonical
home for next-run calculation and scheduled-function registration; definition
CRUD may invoke it but must not reproduce schedule arithmetic or cancellation
behavior. Authenticated automation functions and background AI producers share
the same owner-scoped CRUD operations; internal producers receive the owner from
durable run state and must never persist or forward a user Convex token.
The cross-runtime schedule contract lives in
`@workspace/ai/automation-schedule`. It supports exact one-time instants and
RFC 5545 recurring rules anchored to an IANA timezone. Recurring rules are
evaluated as local wall-clock schedules so daily and weekly tasks stay at the
same local time across daylight-saving transitions. Both manual and tool-based
creation reject schedules that run more than once per hour. A workspace may
have at most ten active automation definitions across creation and every resume
path. Chat creation accepts broader windows such as morning or evening by
choosing a visible local start time before persisting the exact schedule.
Durable task prompts are limited to 64,000 characters, stop conditions to
2,000 characters, and monitoring comparison snapshots to 64,000 characters;
the full assistant answer remains authoritative in chat history.

Scheduled automation execution is not a standalone action loop. The scheduled
mutation delegates to one run-start orchestration operation that atomically
reserves an `automationRuns` row, saves the task prompt into its destination
chat, creates a normal Convex-owned assistant run, and starts the existing
assistant Workflow/Workpool. Manual and scheduled entrypoints do not assemble
those lifecycle steps independently. Automation runs therefore inherit
the same rich message snapshots, approvals, focused user-question pauses,
idempotent tool receipts, three-attempt action retries, and twenty-step logical
limit as interactive hosted chat. `current_chat` destinations continue from the
selected conversation; `standalone` destinations own a dedicated result chat.
Multiple task definitions may use one chat, but the one-active-run-per-chat
invariant still serializes their execution. The minute reconciliation cron
retries a due task whose scheduled function was lost or could not reserve the
busy chat.

`automationRuns` is also the durable task-result inbox. Successful, failed, and
unchanged checks retain their result summary, read state, delivery state, and
archive state and are exposed through cursor pagination. `always` delivery
publishes every successful result. `failed_runs_only` retains successful runs
without marking them unread or emitting notifications while failures remain
unread and notification-eligible. `meaningful_change` compares a scheduled
result with the last observed result in a retryable classification Workflow;
routine checks remain in history without becoming unread. An optional stop
condition is classified at the same boundary and completes the definition when
met. Scheduled unread results are leased transactionally before the renderer
asks Electron to show a native notification, preventing concurrent alerts from
multiple open clients. A successful display is acknowledged durably; failed or
interrupted delivery releases its fenced lease for retry. Clicking the alert
opens the owning chat. Native alerts require the desktop process to be running;
the durable in-app inbox remains the authoritative delivery surface when it is
not.
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

The workspace depends directly on the native TypeScript `7.0.2` package. Do
not add a package named `typescript` to adapt an older deployment builder.
Upgrading either TypeScript or the pinned Vercel CLI requires a successful
production-targeted `vercel build --prod` plus the normal repository checks
before the deployment workflow changes.

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
- `/api/generate-project-description`
- `/api/realtime-transcription-session`
- `/api/dictation-transcription`

Hosted AI route identity, HTTP method, parameterized path matching/building,
and desktop proxy body mode are owned by
`@workspace/ai/hosted-route-catalog`. Vite middleware, Vercel wrappers,
renderer clients, and the desktop loopback proxy consume that catalog instead
of maintaining private endpoint lists. Handler wiring remains in the runtime
that owns the handler; the shared catalog contains transport metadata only.

Chat, note generation, project description generation, template application,
and realtime session creation are transport-only proxies to the web server in
every environment. Dictation
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
Each transcript session stores the live transcription language selected when
capture starts. Explicit languages are reused for initial note generation and
every later template rewrite; Auto-detect remains unpinned and lets the model
follow the stored transcript. Template application also treats that transcript
as the authoritative source for language and facts, so template changes do not
compound a previous generated rewrite. The complete rewrite is structurally
validated before note content is emitted. Generated content and its template
slug are then committed in one `notes.save` mutation, so a failed generation or
save leaves the existing note and template selection intact. Renderer generation
and template rewrites enter that mutation through the same note document session
as autosave; commit metadata carries the template slug so one serializer owns
ordering for every document write. Note UI code must not bypass the document
session with a competing direct save.
Project description generation reads its note context through the
project-scoped `projectDescriptions.getContext` query. The query uses the
project note index to return at most 20 non-archived notes ordered by most recent
update, so context selection is independent of the workspace note-list limit.
If a project disappears while that reactive query is being invalidated, it
returns empty context after workspace authorization instead of surfacing an
expected teardown error; project mutations continue to fail closed when the
project is missing.
When note context exists, it is the authoritative description source and the
previous description is omitted; without notes, the previous description is
used as the rewrite source. Requests without either source are rejected before
model generation.
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

Local-folder chat uses a hosted-model, desktop-tool bridge:

1. The hosted web AI route owns the OpenAI key and model loop.
2. The hosted web AI route declares local folder tools without server-side executors.
3. The desktop renderer receives client-side local tool calls.
4. The renderer executes those calls through the desktop local server against
   folders explicitly shared through the desktop bridge.
5. The renderer attaches tool output and lets the AI SDK resubmit the
   conversation to the hosted web producer for the same run.

Client-side local tool outputs must resubmit with the same chat request body,
including `localFolders`, so subsequent hosted model steps keep the same desktop
tool context. Durable queued replay and steer are the exception: queued request
state is stored in Convex and must reject non-empty `localFolders` rather than
persisting local filesystem selections.
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
`createLocalWorkspaceSession` is the canonical owner of shared-root validation,
root lookup, symlink-safe containment, no-follow file access, traversal limits,
ignored-directory policy, and media-aware local search. Shared roots are
canonical real paths, one chat may expose at most four unique roots, and an
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

Hosted handlers must never claim direct access to the user's Mac filesystem.
Desktop-local capabilities must fail visibly when the desktop bridge contract is
unavailable. Local path references must be registered through
`shareLocalFolders` before they reach `/api/chat`, or request preparation must
fail with an actionable error.
Renderer chat surfaces use `useSharedLocalFolderSession` as the canonical owner
of scope-tagged folder state, storage hydration, cancellation, error clearing,
and request-prepared reconciliation. A late hydration result must never replace
newer request state or expose folders from the previously active chat scope.

On macOS, live transcription must use the desktop transcription controller. It
must not silently fall back to the browser transcription controller when the
packaged desktop bridge is missing or stale.

Global dictation is a desktop-native capability, not a renderer textarea
feature. The desktop runtime owns the global hotkey monitor, microphone capture,
buffered OpenAI transcription, and system paste into the focused app. Renderer
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
Voice transcription does not use the Vercel AI SDK or the official OpenAI SDK:
dictation calls `gpt-transcribe` through direct OpenAI REST, realtime session
creation uses direct OpenAI REST, and live audio uses OpenAI WebRTC or
WebSocket. The Vercel AI SDK remains the shared orchestration layer for
non-transcription AI workflows.

Desktop realtime transcription obtains its short-lived OpenAI client secret
from the authenticated hosted Vercel route through the desktop local server.
The hosted route rate-limits the authenticated identity and sends OpenAI a
SHA-256 hash of the stable Convex token identifier as
`OpenAI-Safety-Identifier`; the raw identity never leaves Graneri's server
boundary. Realtime sessions use `gpt-live-transcribe` with 24 kHz PCM input,
`high` transcription delay, and plural language hints. Browser WebRTC sessions
use OpenAI server VAD; native WebSocket sessions disable turn detection because
Electron commits audio buffers explicitly. Because the model does not expose
transcription logprobs, turn acceptance must depend on transcript state and
placeholder guards rather than a client-side confidence layer. Realtime
recovery is bounded to three reconnect attempts with 750 ms, 1.5 s, and 3 s
backoff. Each attempt must request a fresh short-lived secret. Electron must
never call OpenAI with a long-lived API
key or embed that key in a build.
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
Electron keeps tray-note events in a bounded, expiring request registry and puts
only an opaque request UUID in navigation. The renderer consumes the complete
validated event once through the desktop bridge; invalid, expired, or oversized
requests fail closed and never synthesize an empty attendee snapshot.

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
dependencies belong in the main-process bundle unless their published runtime
loads worker, WASM, or adjacent package assets by path. An asset-backed runtime
must be externalized from the Bun main bundle and traced from the final bundled
Node entrypoint with `@vercel/nft`. Worker entrypoints that load their own
dependencies are additional trace roots. Native optional dependencies are
excluded unless Graneri explicitly uses them. Native modules that cannot be
bundled remain platform-specific optional dependencies. Every traced runtime
and explicitly staged asset must be covered by the package contract and
verifier.

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
remains responsible for static ASAR, configuration, and import checks.

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
Only native helpers, bundled media tools, and asset-backed worker/WASM runtimes
may be unpacked into `Contents/Resources/app.asar.unpacked` through targeted
`asarUnpack` rules.
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

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.
Vercel deployment-boundary changes must also pass `vercel build --prod` with
the production environment pulled for the linked project.
Desktop realtime transcription changes must include the desktop transport tests
for stop-flush behavior, native audio tests for combined-helper AEC3 behavior,
and renderer auto-stop tests for meeting/idle state.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
