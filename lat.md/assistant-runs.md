# Assistant Runs

Assistant modules share model preparation, execution, durable lifecycle, streaming, persistence, human input, and queue behavior across producers.

- [[connected-apps]] assembles provider tools and credentials.
- [[desktop-ai]] owns the desktop-local tool exception.
- [[convex/assistantRunStateMachine.ts]]
- [[convex/assistantRunHumanDecisionResolution.ts]]
- [[convex/assistantRunActivity.ts]]
- [[apps/web/server/chat-accepted-turn-transaction.ts]]
- [producer-neutral execution](../packages/ai/src/hosted-chat-execution.mjs)

## Shared AI package

The shared package exposes explicit interfaces, keeps Convex implementation details behind adapters, and centralizes hosted chat preparation.

This is shared AI runtime code. It must not import Convex server modules or
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

## Tool discovery

Tool availability is derived from runtime executability, authorization, connected capability scope, and explicit chat settings rather than user-message keyword classification.

Graneri-owned implicit tools declare a non-empty model-facing description,
bounded parameter schema, authority policy, and OpenAI deferred-loading metadata.
Connected capabilities additionally use provider namespaces from the canonical
capability registry. Both hosted-web and durable Convex producers assemble every
eligible tool before generation and add OpenAI Tool Search whenever any deferred
tool is present; the model decides which deferred definition to load and whether
to call it. Graneri does not force artifact, image, chart, automation, or
connected-app calls from prompt text. Explicit Web mode remains an immediate
provider tool, while Plan-mode and run-control tools remain immediate protocol
controls supplied only by their owning runtime state.

## Run preparation

One route-facing interface owns follow-up coupling, branch resolution, context compaction, final message tails, and validation.

The route-facing hosted Assistant Run interface exposes intention-level preparation:
`createHostedChatTurnInput` couples the durable Follow-up adapter to its turn
controller, while `prepareHostedAssistantRunInput` owns branch resolution,
rolling context compaction, final Stored UI Message tail assembly, and AI SDK
message validation. Callers must not independently reconstruct either sequence
from private leaf modules.

## Producer-neutral execution

One execution module owns agent construction, streaming, rich message reconstruction, approvals, delivery, and outcomes.

The producer-neutral assistant execution module owns AI SDK agent construction,
stream creation, rich-message reconstruction, explicit streamed or consumed
delivery, tool-approval outcome detection, and completed/aborted outcome
classification. Convex imports this runtime-neutral module through
`@workspace/ai/hosted-assistant-execution`; it must not import the broader
hosted-turn interface because that graph includes web and desktop-local tool
implementations. Stored UI Message validation belongs to the UI message codec.

## Stored message context

One projection defines consequential stored message content for interactive runs, automations, and compaction.

The Stored UI Message context projection is separately canonical: interactive
and automated Assistant Runs preserve text and stable completed-tool outcomes
through `stored-ui-message-context`, and rolling compaction renders the same
consequential content policy. Ephemeral parts and historical file references do
not cross that model-context boundary.
Web and Convex remain producer adapters: web owns desktop-local tool streaming
and HTTP delivery, while Convex owns liveness checks, durable snapshot cadence,
scheduling, and transactional finalization.

## Assistant generation context

Every new assistant generation receives one semantic projection of prior UI messages without response-item references owned by an earlier provider generation.

[assistant-generation-context.mjs](../packages/ai/src/assistant-generation-context.mjs) is the canonical boundary
projection for ordinary turns, queued replay, steer replacement, and resumed
human decisions. It removes only OpenAI `itemId` values from part, tool-call,
and tool-result provider metadata; visible text, reasoning summaries, encrypted
reasoning, stable tool call ids, tool inputs and outputs, phases, and all other
provider metadata remain intact. Hosted preparation applies the projection
before validating a new turn, and Convex applies the same contract when a
durable job is created or its assistant message generation changes. Workflow
checkpoints inside one uninterrupted assistant generation deliberately retain
their live provider item references for the next model/tool step.

## Active stream transport

Turn input buffering and active-stream transport are separate modules with bounded replay, subscribers, and backpressure.

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

## User message persistence

Every normal, replayed, steered, or continued user message enters one ordered accepted-turn transaction and the shared persistence helper.

The hosted accepted-turn transaction first validates active-run policy and the
same-run invariant, then persists local tool output, human decisions, and user
input in protocol order. Normal saves, queued replay accepts, selected queued steer
accepts, and continued-run message appends all enter the shared user-message
persistence helper through a typed Convex persistence port. A producer is chosen
only after those writes succeed. The route keeps HTTP telemetry and response
formatting outside this transaction.

## Hosted stream runtime

The hosted turn executor owns preparation, while one accepted-turn transaction owns validation, persistence, and producer handoff.

The hosted web chat route authenticates the request, parses the complete
client-supplied chat-settings snapshot, and admits the request before delegating to
[[apps/web/server/chat-turn-execution.ts]]. That executor alone claims queued
input, prepares branches and compacted context, resolves connected tools and
local continuations, and passes the runtime four
explicit records: route environment, accepted input, prepared run, and execution
policy. The runtime delegates active-run policy, same-run validation, accepted
local output, decision and user-message persistence, queued acceptance headers,
and exactly-one producer handoff to
[[apps/web/server/chat-accepted-turn-transaction.ts]]. It maps typed transaction
failures through the single [[apps/web/server/chat-turn-route-errors.ts]] seam,
which atomically owns error telemetry, structured logging, accepted-queue
headers, and JSON responses. The runtime then owns web-producer streaming and
finalization.
Reconnect streaming remains transport-only and never reconstructs turn
preparation, acceptance ordering, or producer policy.

## Rolling context compaction

A durable checkpoint compacts fixed history batches without changing saved transcripts and exposes one fenced activity lifecycle.

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

## Replacement branches and forks

Edits preserve replaced history in durable branches, while explicit forks create new immutable chats without changing their sources.

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

## Producer start

Web and Convex producers use producer-appropriate atomic start operations while sharing reject and supersede policy.

Web-produced assistant run start and active-stream session start share one
runtime helper so local-folder turns choose the same reject/supersede policy,
reuse matching continued runs, terminalize failed starts, and clean up
partially-created stream sessions. Convex-produced starts instead create the
run, snapshot, sanitized job, and scheduled action atomically in one mutation.

## Run state machines

State machines own run transitions, queues, snapshots, retries, receipts, producer identity, and single-flight enforcement.

Hosted chat runs are durable Convex lifecycle records.
`assistantRunStateMachine` owns run creation, allowed transitions, ordered
lifecycle events, and mandatory queue/snapshot cleanup; `assistantRuns` exposes
the public Convex function adapters and lifecycle queries. Chat and queue modules
must cross the state-machine seam instead of patching `assistantRuns` rows.
Successful completion also atomically marks the owning active chat with its
unread assistant-completion timestamp. [[convex/chatUnreadState.ts]] owns that
marker, and [[convex/chats.ts]] clears it when the chat is opened. Ask AI history
and Starred render the same chat-owned marker; the active chat suppresses the
indicator immediately while the read mutation settles. Failed, stopped,
superseded, and expired runs never create a new unread marker; archived chats
are not marked by a stale completion.
`assistantQueuedMessageStateMachine` owns follow-up claim, stale-claim recovery,
and terminal cleanup. `assistantQueuedMessageAcceptances` owns selected-row
acceptance: it validates the one claimed row, commits the chat/run transition,
records the exact receipt, and deletes that row only after the commit succeeds.
Public queue functions and chat persistence mutations are adapters to those
owners and must not reproduce their transition rules.
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

## Normal hosted producer

Normal hosted turns start durable Convex work and report reactive snapshots, while optional title generation runs after terminalization.

Normal hosted turns use this Convex producer. The web route authenticates and
prepares the canonical branch/context, persists the user input, starts the
durable job, and closes its SSE response; reactive Convex message and run
queries carry the live rich-message snapshot to workspace and note chat UIs.
Completed first turns terminalize before title generation begins, so optional
title work never keeps the composer in its active Stop state. A bounded title
input then flows through a separate retryable read-only Workflow step, and the
title mutation replaces only an untouched default title so a user rename always
wins.

## Resumable jobs

Sanitized jobs and generation fencing make approvals, continuation, action retries, cleanup, and chat retirement durable and safe.

`assistantRunJobs` retains only the sanitized model input, top-level AI SDK
instructions, explicit feature settings, and connection scope needed to resume the same
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

## Generated artifacts

Convex-owned turns save immutable generated and edited artifacts directly to Convex File Storage.

Image generation and the validated DOCX, PDF, XLSX, and PPTX authoring path
return the same storage-backed artifact result shape, so those files do not
depend on the lifetime of the hosted HTTP request. [[artifact-authoring]] owns
the durable worker, validation, editing, and multi-output boundary.

## Convex steering

Steering atomically checkpoints interrupted output, appends accepted input, rotates the stream, and schedules continued generation.

Steering a Convex-owned turn atomically checkpoints any interrupted assistant
message into both chat history and the resumable job, appends the accepted user
message batch, rotates the assistant message id and active stream, and schedules
the next generation. Every action checkpoint is scoped to that message id so a
stale action cannot overwrite or fail the continued generation.

## Active snapshots

Temporary stream and tool snapshots update atomically and disappear when their owning run reaches a terminal state.

Together they enforce stop/failure/completion history and the
one-active-run-per-chat invariant. `chatActiveStreams` stores the latest complete
AI SDK message parts plus denormalized text, while active `chatToolCalls` stores
the auditable tool lifecycle. Text and message parts are coalesced into one
atomic snapshot update so reactive clients never observe a split producer
checkpoint. Both tables are temporary render snapshots scoped to a run;
terminal runs must leave no stream or active tool snapshots behind. These
records do not move desktop-local tool execution out of the
renderer/local-server bridge.

## Run activity projection

One bounded plan projection connects model progress to the active composer without turning transient UI into the source of truth.

Both hosted producers expose the same `update_plan` runtime tool. The shared AI
package validates a plan as two to twelve ordered steps with exactly one active
step unless all work is complete. [[convex/assistantRunActivity.ts]] revalidates
that contract at the persistence boundary, updates the single
`assistantRunActivities` row for the active run, and appends the same plan as a
durable `plan.updated` event in one mutation. Chat and note renderers subscribe
to the active projection and show a compact progress badge above the composer;
hover or keyboard focus reveals completed, active, and pending steps. The plan
does not appear in the transcript. Terminalization deletes the active
projection while preserving the event journal for replay and diagnosis.

## Run event timeline

Append-only typed events preserve lifecycle and tool details without duplicating high-frequency streamed text.

`assistantRunEvents` is the durable ordered timeline for a run. It records typed
events such as run start/stop/fail/complete, tool lifecycle changes, completed
assistant messages, and human-input requests. Events are append-only per run and
queried by `runId` plus `eventIndex`. Tool lifecycle events must be
self-contained for replay/debugging: started events carry the serialized tool
input when available, and completed events carry serialized output or error
details when available. High-frequency streamed text belongs in the active
stream snapshot during the run and in the saved assistant message after
completion; it should not be duplicated as per-token event rows.

## Fail-closed snapshot writes

A missing, mismatched, or terminal active snapshot is producer divergence and must fail the run visibly.

Active stream snapshot writes are fail-closed runtime state. Appending text or
tool lifecycle updates to a missing snapshot, wrong run, or non-running run is a
producer/state divergence and must surface as a stream failure that terminalizes
the run; it must not silently drop output.

## Finalization

Client stream success requires completed durable finalization, while a Convex start response only acknowledges durable handoff.

A web-produced client stream must not close as successful until completed-run
finalization has saved the assistant message, closed temporary stream/tool
snapshots, and terminalized the `assistantRuns` record. Finalization failures
are request failures, not background cleanup. A failed finalization attempt
must leave the same terminalization pending so a later flush can retry; it must
not poison the finalization queue with a permanently rejected in-flight
promise. A Convex-produced route response is only a durable-start handoff and
may close while the scheduled action continues.

## Reconnect recovery

Reconnect and stop terminalize abandoned web producers without disturbing durable Convex, waiting-for-user, or pending desktop-local runs.

Reconnect recovery follows the same no-leftover rule for `web` producers: when
a reconnect finds a running web run without a live in-process stream producer,
the route must mark the run stopping, attempt to save/delete the active stream
snapshot, and terminalize the run in a `finally` path. A `convex` producer is
already durable and must not be failed merely because no web process owns it. A
`waiting_for_user` run intentionally has no live stream producer and must remain
pending across reloads; both the renderer and reconnect route skip stream
attachment for that state. A web run with a bound local capability and pending
local tool calls is also intentionally detached while Electron executes or
recovers those calls; reconnect must leave that durable run and its snapshots
intact. Snapshot cleanup failures may still surface to the
caller, but they must not leave the run blocking future queue drain or chat
sends. Manual stop uses the same shape: record durable stop intent before stream
cleanup, and terminalize in `finally` after cleanup is attempted.
Snapshots remain the live render surface; historical inspection, future missed
event replay, and debugging should use run events plus saved messages rather
than preserved snapshot rows.

## Stream resume

HTTP stream resume applies only to a live web producer; Convex producers resume through durable jobs and reactive snapshots.

AI SDK HTTP stream resume applies only to `web` producers and must attach to a
non-terminal `assistantRuns` record plus its live in-process producer. It must
not infer lifecycle from partial stream text. If Convex has an attachable web
run but the current process has no matching producer, the run fails and
temporary snapshots are cleaned up rather than returning a synthetic stream.
Convex producers resume through their durable job and reactive snapshot instead
of HTTP SSE attachment. Resume request preparation must fail when required
workspace or authentication state is unavailable; it must not fall back to the
normal chat send endpoint.

## Chat settings and planning mode

One required chat-owned settings snapshot controls every turn while account-scoped last-used settings seed new draft composers.

The shared [chat-settings contract](../packages/ai/src/chat-settings.mjs) groups
mode, web search, model, reasoning effort, and service tier. A new draft starts
from the account-scoped last-used settings in [[convex/chatPreferences.ts]],
which returns `DEFAULT_CHAT_SETTINGS` before the account has selected anything.
Every control change replaces those next-chat defaults.
[[apps/web/src/hooks/use-chat-settings.ts]] still treats a stored chat as the
authority for its own settings. The first accepted user message persists the
complete snapshot atomically with chat creation. Opening a stored chat restores
its required fields, subsequent control changes atomically replace both that
chat's snapshot and the account's next-chat defaults, and a fork copies the
source snapshot to the new chat. Assistant-message persistence never changes
it. There are no optional-field or browser-storage fallbacks for stored chat
settings.

Note discussions share the remembered model, reasoning effort, and service tier
but have a narrower capability boundary: their persisted and request snapshots
always use default mode with web search disabled. Changing a visible note-chat
setting updates those three account defaults without replacing the hidden Plan
or Web choices last selected in Ask AI. This keeps new note discussions
convenient while preventing unavailable controls from silently changing either
surface.

The footer controls remain owned by
[[apps/web/src/components/chat/chat-composer-options.tsx]]. Selecting planning
mode adds a Lightbulb-labelled `Plan` control to the composer footer; hovering
the control replaces the Lightbulb with a close affordance, and activating it
returns only that chat or draft to default mode. All five settings travel with
normal and durable queued requests, so replay and steering cannot silently
change the selected runtime configuration.

The shared hosted runtime converts planning mode into trusted instructions
before either producer starts. Planning mode explores relevant context, asks
focused questions through `request_user_input` only when missing decisions
would materially change the plan, returns an ordered plan, and avoids mutation
until the user asks to proceed. Default mode receives neither the planning
instructions nor the structured questionnaire tool; it proceeds from available
context and reasonable assumptions. Background runs persist the canonical chat
mode alongside the already-resolved instruction set so retries reconstruct the
same capability surface instead of inferring behavior from prompt text.

## Chat project scope

One required nullable project relationship makes a cloud project the durable container for a workspace chat without conflating it with runtime settings or desktop-local access.

Workspace chats persist `projectId` independently from the five-field chat
settings snapshot. A new draft begins with no project, a stored chat remains
authoritative for its own project, the first accepted turn persists the draft
selection atomically with chat creation, later changes enter through the
project-scoped chat mutation, and forks copy the source relationship.
[[apps/web/src/hooks/use-chat-project.ts]] owns the renderer selection lifecycle,
while [[convex/chatProjectState.ts]] validates that both the chat and selected
project belong to the authenticated workspace.

Project membership grants access to project-owned notes without injecting every
note into every prompt. The assistant receives bounded `search_project_notes`
and `get_project_note` tools from
[project-note-tools.mjs](../packages/ai/src/project-note-tools.mjs); the Convex
executors in [[convex/chatProjectNotes.ts]] derive scope from the persisted chat,
enforce workspace ownership again, and return only requested note content.
Search results and reads are bounded; long reads return an explicit continuation
offset so the model can retrieve the rest without mistaking a clipped excerpt
for the complete note.
Project scope is available to normal, queued, steered, and background turns.
It does not include or persist a desktop filesystem path: the local-folder
capability remains an independent Electron-owned source and cannot enter a
durable queue.

## Human decisions

Questions and tool approvals persist typed pending decisions and resume the same run through atomic validation.

Human-blocking assistant work uses `waiting_for_user` plus a typed
`pendingDecision` on the run. Producers must resume the same run after the
decision instead of creating a second active run. Normal duplicate sends must
reject before persisting a new user message when a chat already has a
non-terminal run; clients must queue follow-ups against the active run.
Plan-mode clarification uses the producer-neutral `request_user_input` tool. It
asks one to three focused single-select questions. Independent multi-choice
decisions are expressed as a sequence of Yes/No questions, matching the native
single-select questionnaire contract. Tool
approvals remain available in either mode because authorization is an execution
requirement rather than planning clarification. The shared Human Decision bar
presents questionnaires and approvals through one interface in chat and note
composers. Question options include a compact label and concise secondary
description. Each question offers two or three mutually exclusive choices; the
producer puts its recommended choice first and suffixes that label with
`(Recommended)`, which the renderer presents as a badge. Every question also
includes a free-form `Other` path.
The write-in field uses the stable `Something else...` placeholder rather than
model-generated copy.
The questionnaire takes focus when it appears so its keyboard contract is
available even when the composer previously held focus. Clicks and their
displayed `1`–`3` shortcuts acknowledge the choice, then advance or submit
directly. Arrow keys highlight choices or move between questions, and `Enter`
confirms the highlighted choice or a focused free-form answer. `Skip` advances
without selecting an option, while `Escape` and the close action dismiss the
unresolved questionnaire. Multi-step answers are serialized as quoted
questions followed by their selected and free-form values. Both producers
persist the exact assistant message id, tool call id, ordered prompts, and
option labels and descriptions as a `user_question` decision. Accepting the
direct durable answer enters `assistantRunHumanDecisionResolution`, the single
transaction for both human decision variants. It verifies the stored request,
converts the pending question tool part in that assistant message to
`output-available` with the structured answer, records `input.resolved`, rotates
the assistant message generation, cleans the previous generation snapshots,
and resumes the same producer. Questionnaire answers never create
synthetic user messages; a normal user message cannot resolve a pending
questionnaire or bypass a pending tool approval. The renderer dismisses a
questionnaire as soon as its local tool output is recorded, then restores the
same pending card if continuation fails before the durable decision resolves.
Tool approval uses the AI SDK v7 `toolApproval` protocol rather than
tool-specific confirmation payloads or synthetic user messages. The first
stream persists the assistant message in `approval-requested` state and moves the run to
`waiting_for_user` with a `tool_approval` decision. The response mutation
delegates to the same resolution transaction, which must atomically verify the
approval id, assistant message id, tool call id, and tool name, persist the
`approval-responded` message, update the durable background job when present,
consume admission, clean the previous generation, and resume that same run
before a replacement stream starts. `assistantRunStateMachine` owns the
producer-neutral decision-resolution state transition; the Human Decision
Resolution module owns its ordered persistence and producer-restart protocol
for both variants. `input.requested` journals the full typed decision
and `input.resolved` journals the exact approval result or questionnaire answer.
The decision row does not duplicate tool input: the stored assistant
message and tool-call journal remain its durable owners.
The [tool-authority module](../packages/ai/src/ai-tool-authority.mjs) is the
single owner of approval classification and AI SDK approval configuration.
Every Graneri-owned tool definition declares whether approval is required;
write-capable automation tools require it, while read-only and generative
artifacts are classified explicitly. Approval presentation remains distinct
from the questionnaire: it shows the access category, permission question,
authority consequence, and stored tool input, with explicit deny and one-time
approval actions. Runtime code must not infer approval from a tool name or
maintain a second approval registry.
Human Decision chat input must never collect passwords, tokens, credentials, or
other secrets. Secret entry requires a separate encrypted credential boundary;
until that boundary exists, the question contract rejects that use explicitly.
`startAssistantRun` only supports reject or explicit supersede policies;
it must never return an existing active run as a fallback. Assistant runs are
created directly as `running`; queued work is represented by
`assistantQueuedMessages`, not by a queued assistant-run status. Queries that
attach to or report the active run must fail closed if more than one
non-terminal run exists for a chat, because choosing a winner would hide a
broken single-flight invariant. Regenerate is the explicit supersede path. Stop requests are
idempotent at the HTTP boundary: no attachable run means there is nothing left
to stop, so the route may return success without creating synthetic run state.
A Stop that crosses consumed steer input prepares one immutable assistant/user
generation-boundary snapshot and retains its hosted session until
`chats.stopActiveStream` commits that exact snapshot. A transient durable-stop
failure leaves the run in `stopping` with the same snapshot available for retry;
only a successful durable stop may dispose the session and finish the stopped run.

## Durable follow-up queue

Queued messages contain canonical bounded input and replay context without credentials, duplicate identity, or local filesystem paths.

Follow-up queueing is durable run state, not UI-local buffering.
`assistantQueuedMessages` stores queued user messages and durable request
context scoped to the active run. It may persist the strict opaque local
capability descriptor, but never an Electron path or renderer-owned folder
record. Follow-ups retain that descriptor so queued replay and steer use the
same authorized scope; Electron still revalidates the id before every local
execution. Queue rows have four explicit states: `queued` rows auto-drain after
normal completion, `paused` rows remain visible after stop, supersede, failure,
or expiry and require a row-level Retry, and `claimed` rows are a server-owned
pre-acceptance lease. `editing` rows are durable drafts excluded from dispatch and
visible queue queries. [[convex/assistantQueuedMessageEditing.ts]] atomically
checks a visible row out for editing; save and cancel require its incremented
`claimVersion` and restore its original position and queued or paused state.
There is one draft per chat; switching edits restores the previous draft in
the same transaction. Stop and failure pause its return state without making
it executable. [[apps/web/src/hooks/use-queued-message-edit.ts]] restores the
composer from that draft after navigation. The renderer never claims or deletes a row as part of
submission. [[convex/assistantQueuedMessageDispatch.ts]] reads the run and FIFO
head in one snapshot. It returns a dispatchable row only when no non-terminal
run remains and the head is queued; the authenticated app sends that row
id with the observed `queued` status, and the hosted route claims that exact row
only if its durable status still matches. Row-level Retry sends the observed
`paused` status instead. Stop therefore invalidates an already-started automatic
drain request before it can reclaim paused work. Each successful claim
increments a durable `claimVersion`; release, scheduled recovery,
replay acceptance, and steer acceptance must present that exact version so a
slow request cannot act on a later re-claim of the same row. The queue is capped
at twenty rows per chat, which also bounds terminal pause and release work.
`userPreferences.followUpBehavior` is the single required Queue-or-Steer
preference shared by chat and note composers. Queue is the default for new
preferences; existing records must store an explicit value. While an
assistant run is active, both modes first admit the follow-up as a durable row;
Steer then immediately sends that exact row through the fenced steer path using
the run ID returned on the admitted row. This remains valid during the brief
request-to-subscription handoff where the renderer has not attached the active
run query yet. A pre-accept steer failure leaves the row recoverable. The queued
row menu's Turn on or Turn off action and the Preferences select update only
this preference: neither action deletes, sends, resumes, or reorders an existing
row.
[[apps/web/src/lib/chat-queued-followups.ts]] owns the server and visible queue
snapshots. Its named changes apply Delete and reorder locally; reconciliation
preserves hidden rows and local order across unrelated server updates. Server
removals and changed server order remain authoritative. A rejected Delete
restores only a surviving row using its current server content. A rejected
reorder restores the prior relative order only when no newer reorder or
external order change supersedes it. The last subscriber clears presentation
changes. Editing belongs entirely to the durable state machine.
Automatic dispatch is mounted at the authenticated app level for every
workspace. Chat discovery paginates the owner/workspace queue index with bounded
row and byte reads. Navigation does not stop execution. Each dispatched request
uses the shared chat client, including desktop-local tool continuation. Steer and Retry remain visible until the hosted route confirms
durable acceptance; their completion is not optimistic.
When the renderer owns a just-submitted turn but its active-run subscription has
not attached, every later input uses `enqueueForCurrentRun`: one Convex
transaction inserts the row against either the unique current run or the oldest
`queued`, `claimed`, or `paused` continuation reservation. It returns the
discriminated `no_active` result only when neither exists. This makes replay
setup and run creation one FIFO admission boundary: if replay acceptance commits
first, the new row attaches to its successor run; if admission commits first,
the row appends behind the existing reservation. Only `no_active` permits the
renderer to start a normal turn, so AI SDK request status and subscription
timing never decide whether a follow-up queues. During any request-to-run
handoff frame where no exact queue run is attached, remaining rows expose no
replay action; row-level Steer appears
only after that run is known.
Input uses upstream app-server input
gates: HTTP chat routes and client queue serialization reject empty user text
before it can enter the AI SDK loop or durable queue state. Convex chat and
queued-message mutations enforce the actual 1 MiB document limit with
`getDocumentSize` at the write boundary instead of approximating storage size
from character counts. Queued rows persist canonical text, a required uploaded-file payload, and the
minimum replay context: they omit credentials, local filesystem paths,
duplicate workspace identity, and note contents that can be reloaded by note ID.
The renderer and Convex parse that replay context through the single
`@workspace/ai/queued-chat-request` contract; neither side accepts an arbitrary
object container or maintains a parallel request-shape check.

## Rich message codec

All stored rich messages cross one strict codec, with tolerance limited to explicit historical projection helpers.

Rich message JSON crosses storage and runtime boundaries only through
`@workspace/ai/ui-message-codec`. Strict consumers fail closed on malformed
parts, metadata, message arrays, and any stored role other than `user` or
`assistant`; historical model-input projection may skip malformed rows only
through the codec's explicitly tolerant helpers. The durable chat-message write
seam validates AI SDK message semantics and stores canonical rich parts JSON.

## Replay and steer acceptance

Replay and steer reconstruct server-owned input, accept it atomically, and preserve acceptance through later setup failures.

Replay is server-owned: the client rebuilds request state through the
queued-intent module with a fresh Convex token and sends
`replayQueuedMessageId` with the row's observed `queued` or `paused` status;
`/api/chat` must atomically reject a status mismatch, claim that exact durable row, and
reconstruct the user message from it before branch, tool assembly, or persistence
preparation. It must then atomically save the user
message, delete the claimed queue row, consume admission, and create the next
assistant run through `acceptQueuedUserMessageAndStartRun` in one Convex
transaction. Any pre-accept route failure releases the
claim to its original `queued` or `paused` state; successful replay must not
depend on a client cleanup mutation. Post-accept replay setup
failures must carry `X-Graneri-Replay-Accepted: true` and
`X-Graneri-Replay-Queued-Message-Id` so the transport can resolve the already
accepted input as an empty successful stream instead of rolling it back. The
queued-intent module marks replay origin explicitly as `automatic` for FIFO drain
or `manual` for a row action; the renderer transport consumes and removes that
client-only marker before forwarding the hosted request. Status alone never
implies origin. Automatic replay preparation statically requires a `queued` row,
and stale-response normalization defensively requires both that status and the
explicit `automatic` origin. Manual replay keeps failures visible, while an explicitly
automatic replay that loses a delete or cross-client race and receives
`QUEUED_MESSAGE_NOT_FOUND` resolves as an unaccepted empty stream; it must not
append an assistant error, fire an acceptance callback, or mutate another row.
Replay claim admission returns the explicit `claimed`, `active_run`, or
`unavailable` result instead of throwing for expected lifecycle contention.
The hosted turn controller projects `active_run` and `unavailable` into the same
structured 409 contract used by manual row actions, while only an explicitly
automatic `unavailable` replay is normalized to an empty stream. A stopping run
remains an automatic-drain blocker even though it is no longer attachable for a
row action, preventing Stop handoff from creating an optimistic phantom replay.
Manual `queued` or `paused` replay, steer, and all other queue failures retain
their normal error behavior. Manual
steer must be prepared as a queued steer intent and sent through
`/api/chat/steer` with both `steerQueuedMessageId` and the expected active
`continueRunId`; ordinary `/api/chat` requests must reject steer payloads
instead of falling back to implicit behavior. The hosted route must return a
structured `{ error, errorCode }` JSON body for
queued replay and steer validation failures, and must reject malformed IDs
before Convex state lookup or mutation. Steer input is queue-id driven: the
server reconstructs the user message from the claimed durable queue row and must
not require or trust a client-supplied `message` body. The hosted chat turn
controller claims only the selected queued message through adapter callbacks,
rebinding a visible row from a completed or stopped predecessor to the current
run when necessary. A
`waiting_for_user` run reserves the composer for its pending typed decision, so
queued row actions remain disabled until that decision resolves. The route then atomically
accepts the claimed queue row by saving the user message, recording
`turn.steer.accepted` plus `user.message.appended` on the same `assistantRuns`
timeline, deleting the claimed queue row, and recording an exact-generation
pending steer input without interrupting or terminalizing the current response.
At a safe model-step inside the still-running provider generation, the producer
appends accepted steer input to the next step without projecting context or
rotating the assistant message id. That step is part of one uninterrupted
generation, so its valid generation-bound OpenAI item references remain intact.
If the current response naturally completes before the input can enter another
step, the producer saves the completed assistant response and starts a
replacement generation in the same run. Only that replacement boundary projects
the full ordered transcript through the canonical assistant-generation context,
discards generation-bound OpenAI item references while preserving semantic
reasoning content, and rotates the assistant message id.
Web-produced runs reserve a single-use acceptance lease on their exact active
generation before the durable commit. Terminal cutover seals the generation
before waiting for issued leases, rejects every new reservation, and lets only
an already-issued lease attach before the producer snapshots the boundary. A
replacement generation reopens admission only after its execution starts.
When the response is waiting for a human decision, accepted steer input remains
durable without starting a replacement; the decision resolves first, then the
same input is projected exactly once into the resumed generation. Both replay
and steer accept mutations validate the saved user message id, text, and canonical text/file
parts against the claimed durable queue row; callers must not trust
client-supplied message bodies over durable queue state. The streaming response
carries `X-Graneri-Steer-Accepted: true`, `X-Graneri-Turn-Id`, and
`X-Graneri-Queued-Message-Id` headers after the atomic accept succeeds so clients
can distinguish accepted steering from ordinary sends without changing the AI
SDK stream body. Post-accept setup failures must preserve these headers because the steer
was already accepted by the active turn. The web transport
must treat non-2xx steer responses with these headers as accepted empty streams
instead of rolling back the queued UI item; pre-accept failures without the
headers still surface as normal send failures. Normal completion releases any
unaccepted claim to its exact prior visible state. Stop and supersede pause all
unsent rows as `interrupted`; a failed or non-stopping expired run pauses
the executable FIFO head and any editing draft return state as `failed`. Replay may claim only that head, so later
rows cannot skip a failed item. `resumeInterruptedForChat` atomically restores
only `paused` interruption rows to `queued`; failed rows remain paused for an
explicit Retry, Edit, or Delete.
Renderer chat surfaces expose interruption recovery through the primary
composer action rather than a separate queue banner. When interrupted rows
exist and the composer has no sendable draft or attachment, the primary action
is Resume; entering new sendable input restores Send, which submits that input
without implicitly resuming the interrupted rows. The shared decision lives in
[[apps/web/src/components/chat/chat-composer-primary-action.ts]], while
[[apps/web/src/components/chat/chat-queued-follow-up-bar.tsx]] renders only the
durable queue rows.

[[convex/assistantQueuedMessageAcceptances.ts]] owns atomic acceptance and a
durable idempotency receipt keyed by `queuedMessageId` plus `claimVersion`.
The receipt records the accepted chat message, run, and assistant generation in
the same transaction that removes the claimed row. If an HTTP mutation response
is lost, the hosted transaction queries this owner- and chat-scoped receipt:
an exact accepted receipt reconstructs the authoritative replay or steer
headers and identities, `not_accepted` permits claim release, and a failed or
conflicting lookup remains ambiguous and must not release the claim. Exact
mutation retries return the persisted result; changed arguments fail closed.
Receipts are retained for a bounded 24-hour retry window. Each insert schedules
deletion through an acceptance-owned internal mutation fenced by receipt id,
queued message id, and claim version, so a stale cleanup cannot delete a newer
receipt. Chat retirement also deletes remaining receipts.

Queued files use the strict [queued-chat-files contract](../packages/ai/src/queued-chat-files.mjs).
[[convex/assistantQueuedMessageAttachments.ts]] validates each storage URL and
size against the uploaded file and owns indexed queue storage references.
Admission, edits, and reference changes are atomic. Replay and steer construct
text and files from the claimed row; acceptance rejects changed or extra parts.
Accepted history acquires its references before queue references are released.
Discard and chat/run removal release queue references; physical storage remains
while any queue, chat, or note owns it.

## Cleanup and attachments

Run cleanup preserves unsent input, while attachment references retain physical storage until the final owning chat retires.

Terminal run cleanup removes live snapshots without deleting unsent input.
Normal completion releases an unaccepted claim to its recorded origin; stop,
and supersede pause every queued and claimed follow-up as `interrupted`, while
failure and non-stopping expiry pause only the literal FIFO head as `failed`.
Only explicit
row Delete, whole-run discard, or chat removal destroys unsent rows. Client
mutations for visible queued or paused rows must be scoped by workspace and chat
and must fail closed when the row belongs to another chat or is claimed;
wrong-scope cleanup must preserve the row rather than hide a stale client or
cross-session bug.
Chat deletion must fail closed on invalid persisted attachment metadata or
storage ids, including attachment references retained by preserved branches;
cleanup must not silently skip malformed stored attachment references and
continue deleting surrounding chat state. Active and forked chat messages own
explicit attachment-reference rows, so deleting one chat releases only its
references and physical storage is removed only after the final referencing
chat is permanently retired. Branch replacement retains attachment references
until its owning chat is retired.
Claim mutations schedule a claim-version-fenced lease recovery and also recover
stale claims before another claim attempt, because `claimed` represents an
unaccepted in-flight operation and must not become an invisible durable leftover
after a client or transport crash. Durable queued request state may retain only the opaque local
capability descriptor; absolute paths remain Electron-private.

## Queue behavior reference

Graneri matches the upstream active-turn responsibilities through hosted transport adapters and durable Convex coordination.

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
| Replay after a completed turn uses server-owned queued input. | `/api/chat` requires `replayQueuedMessageId` plus the observed state; Convex permits only the literal FIFO head, rejects interrupted rows until `resumeInterruptedForChat` restores them to `queued`, and atomically validates the claim version, saves the user message, deletes the claim, consumes admission when needed, and creates the next web or Convex run. | Implemented |
| Accepted input remains accepted even if later stream setup fails. | Replay and steer routes emit accepted headers and the web transport resolves post-accept failures as empty successful streams. | Implemented |
| Stale or wrong targeted input does not silently disappear. | Replay claims return typed `active_run` or `unavailable` outcomes for expected contention, which remain visible for manual row actions; invalid chat scope and lifecycle invariants still fail closed, as do invalid steer claims. | Implemented |
| No queued assistant-run fallback exists. | Runs start directly as `running`; durable follow-ups live only in `assistantQueuedMessages`. | Implemented |
| Stale claimed input is not an invisible leftover. | Claims remember the exact prior visible state, including a paused row's `failed` or `interrupted` reason; every claim increments `claimVersion`, and only that version can accept, release, or recover the lease. | Implemented |
| Waiting-for-user input cannot be mistaken for steer input. | `waiting_for_user` reserves continuation for the typed pending decision. Queue row actions are disabled, and server claims reject the run until the decision resolves. | Implemented |
| Stale assistant generations cannot mutate their replacement. | Active-stream start, update, tool calls, stop, snapshot deletion, final message save, wait, complete, and fail all compare the expected assistant message id; local session replacement occurs only after the durable generation check succeeds. | Implemented |
| Destructive tools pause for durable user approval. | AI SDK approval parts are persisted on the assistant message; Convex stores a typed `tool_approval` decision, validates the matching response atomically, appends `input.resolved`, and resumes the same run. | Implemented |
| Human-blocking work has one typed interface and durable resolution. | The shared Human Decision bar renders approvals with consequences plus compact single-select and multi-select questionnaires; Convex journals full requests and exact resolutions, then resumes the matching web or Convex producer through one state-machine transition. | Implemented |
| Accepted steer input has one explicit continuation boundary. | Convex producers persist an exact run-and-assistant-generation steer inbox; hosted web sessions issue single-use leases, seal before terminal snapshot, drain issued leases, and reject new reservations until a replacement execution starts. A safe model-step preserves valid provider references; natural completion projects generation-bound metadata once, while a human-decision boundary keeps the steer durable until the decision resolves and then carries it exactly once. | Implemented |
| Multiple active-turn inputs can accumulate without a row action consuming its neighbors. | Graneri persists multiple queued follow-ups; each row Steer intent is serialized by the renderer, `claimForSteer` claims only the selected row and rebinds that row to the current run, and `acceptSteeredUserMessage` atomically saves and deletes only that accepted row. Remaining rows retain FIFO order for later steer or normal completion drain. | Implemented |
| Activity subscribers can distinguish mailbox work from steered input. | Hosted active stream sessions expose `subscribePendingInputActivity`; pending steered input reports `steer`, queued mailbox-style input reports `mailbox`, and subscribing after input is already pending returns the pending activity. | Implemented |
| A model tool can wait for mailbox or steer activity. | Graneri exposes a runtime-only AI SDK `wait_agent` tool. It subscribes to hosted active stream activity, wakes immediately on already-pending activity, returns app-server-compatible `{ message, timed_out }` results for mailbox, steer, and timeout, and aborts with the active turn. | Implemented |
| A multi-step run can expose durable current and completed work without polluting the transcript. | Both producers expose `update_plan`; Convex atomically updates one bounded active projection and appends `plan.updated`, while chat and note composers render the projection as a floating badge with an accessible plan popover. Terminal cleanup removes the projection but retains the journal. | Implemented |
| Mailbox delivery is accepted into turn state. | Hosted active stream sessions keep mailbox-style pending input separate from steered input, can defer mailbox delivery after an answer boundary, and reopen delivery when steered input arrives. Replacement sessions carry both steer and mailbox pending input forward. | Implemented |
| Long visible history is explicit and recoverable. | The renderer subscribes to cursor-paginated newest-first Convex pages, prepends the active rich stream on the first page, and automatically loads the next bounded page when the transcript reaches the shared scroller's near-start boundary. The canonical message scroller preserves the visible anchor while older rows prepend. | Implemented |
| An assistant answer can fork into a new chat without changing its source. | The `Fork chat` assistant message action creates an immutable fork through the selected stored answer, records its lineage, shares attachment lifetime safely, opens the new chat, marks it as forked, and separately discloses any ancestry omitted by the bounded copy. | Implemented |
| Editing or regeneration does not destroy the replaced history. | Convex archives the replaced active suffix and retains its attachment references before starting the replacement turn. A full thread-fork and branch-switching UI is not exposed yet. | Partial |
| A model can create and manage live subagents. | Graneri does not expose subagent tools because the product does not have subagents. Runtime tools such as `spawn_agent`, `send_message`, `followup_task`, `list_agents`, and `interrupt_agent` are intentionally out of scope. | Not applicable |

## Renderer interaction ownership

Renderer chat surfaces share optimistic state, stop arbitration, queue drain, and note discussion sessions.

The queue, steering, replay, and run-lifecycle slice keeps Stop and Steer as
separate user actions: composer Stop always interrupts the active generation and
pauses queued rows, while a row-level Steer injects only the selected row.
Graneri keeps mailbox activity
and wait primitives for active-turn user input, but it does not implement
reference subagents. Graneri injects accepted input at the next safe AI SDK
`prepareStep` boundary when the provider generation is still running. If that
generation completes first, Graneri drains the input across the stream restart
into a projected replacement prompt. Convex remains the durable source of truth
for user input, chat runs, crash recovery, and cross-process coordination.
