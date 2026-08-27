# Assistant Runs

Assistant modules share model preparation, execution, durable lifecycle, streaming, persistence, human input, and queue behavior across producers.

- [[connected-apps]] assembles provider tools and credentials.
- [[desktop-ai]] owns the desktop-local tool exception.
- [[convex/assistantRunStateMachine.ts]]
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

Every normal, replayed, steered, or continued user message enters the shared persistence helper.

The hosted chat route uses the shared user-message persistence helper for normal
saves, queued replay accepts, queued steer batch accepts, and continued-run
message appends; the route keeps HTTP telemetry and response formatting while
shared modules own chat behavior.

## Hosted stream runtime

The hosted stream runtime owns active-run policy, accepted input, start, finalization, initial streaming, and reconnect streaming.

The hosted web chat route delegates active-run policy, same-run validation,
queued acceptance headers, assistant-run start, stream finalization, initial
AI SDK stream piping, and reconnect stream piping to its hosted stream runtime
module so HTTP parsing/context assembly stays separate from turn execution.

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

## Generated image artifacts

Convex-owned turns save generated images directly to Convex File Storage.

Convex-owned turns save generated-image artifacts directly through Convex File
Storage, so those files do not depend on the lifetime of the hosted HTTP
request.

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

Reconnect and stop terminalize abandoned web producers without disturbing durable Convex or waiting-for-user runs.

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

## Human decisions

Questions and tool approvals persist typed pending decisions and resume the same run through atomic validation.

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
The [tool-authority module](../packages/ai/src/ai-tool-authority.mjs) is the
single owner of approval classification and AI SDK approval configuration.
Every Graneri-owned tool definition declares whether approval is required;
write-capable automation tools require it, while read-only and generative
artifacts are classified explicitly. Approval presentation includes the
authority consequence and stored tool input so the user can review the action
before responding. Runtime code must not infer approval from a tool name or
maintain a second approval registry.
`startAssistantRun` only supports reject or explicit supersede policies;
it must never return an existing active run as a fallback. Assistant runs are
created directly as `running`; queued work is represented by
`assistantQueuedMessages`, not by a queued assistant-run status. Queries that
attach to or report the active run must fail closed if more than one
non-terminal run exists for a chat, because choosing a winner would hide a
broken single-flight invariant. Regenerate is the explicit supersede path. Stop requests are
idempotent at the HTTP boundary: no attachable run means there is nothing left
to stop, so the route may return success without creating synthetic run state.

## Durable follow-up queue

Queued messages contain canonical bounded input and replay context without credentials, duplicate identity, or desktop-local folder scope.

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

## Cleanup and attachments

Run cleanup removes live and queued state, while attachment references retain physical storage until the final owning chat retires.

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

## Renderer interaction ownership

Renderer chat surfaces share optimistic state, stop arbitration, queue drain, and note discussion sessions.

The current queue, steering, replay, and run-lifecycle slice is close to the reference
for durable correctness and fail-closed behavior. Graneri keeps mailbox activity
and wait primitives for active-turn user input, but it does not implement
reference subagents. Graneri drains accepted input at the AI SDK stream restart
boundary into the next prompt branch, while Convex remains the durable source of
truth for user input, chat runs, crash recovery, and cross-process coordination.
