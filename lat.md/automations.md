# Automations

Automation modules own schedules, reservations, execution state, assistant-run delegation, result classification, delivery leases, and the durable inbox.

- [[assistant-runs]] executes automation prompts through the normal durable run lifecycle.
- [[convex/automationRunStateMachine.ts]]
- [[convex/automationSchedule.ts]]

## State and schedule contract

One state machine owns run transitions, one schedule module owns calculation and registration, and one cross-runtime contract validates recurrence.

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

## Execution

Scheduled and manual starts share one atomic orchestration operation and inherit the normal assistant Workflow and single-flight rules.

Scheduled automation execution is not a standalone action loop. The scheduled
mutation delegates to one run-start orchestration operation that atomically
reserves an `automationRuns` row, saves the task prompt into its destination
chat, creates a normal Convex-owned assistant run, and starts the existing
assistant Workflow/Workpool. Manual and scheduled entrypoints do not assemble
those lifecycle steps independently. Automation runs therefore inherit
the same rich message snapshots, approvals, focused user-question pauses,
idempotent tool receipts, three-attempt action retries, and twenty-step logical
limit as interactive hosted chat. `current_chat` destinations continue from the
selected conversation and capture that chat's live mode, model, reasoning
effort, service tier, and Web setting when each run is reserved. Appending an
automation turn must not replace the attached chat's settings or title.
`standalone` destinations own a dedicated result chat and run in Default mode
with the automation definition's model, effort, service tier, Web setting, and
selected app sources. The same definition settings become the standalone
configuration if deleting an attached chat moves its automations to fresh
result chats.
Multiple task definitions may use one chat, but the one-active-run-per-chat
invariant still serializes their execution. The five-minute reconciliation cron
retries a due task whose scheduled function was lost or could not reserve the
busy chat.

Each automation also stores one required nullable cloud `projectId`, separate
from its model and capability settings. A standalone run assigns that project
to its dedicated destination chat before execution, so project-note tools can
retrieve relevant notes on demand. Creating a standalone definition from chat
copies the source chat's project inside the same [[convex/automations.ts]]
mutation that creates the definition; both hosted and durable-run adapters pass
only the source chat identity, so ownership cannot change between a separate
read and write. The automation dialog stores its explicit selection. A
`current_chat` run instead uses the attached chat's live
project relationship at reservation time; changing a definition cannot
silently replace the container of an existing chat. Assistant-authored updates
also preserve the definition's project inside their mutation instead of
round-tripping the relationship through an adapter. Project deletion clears
affected automation relationships through the same retirement path that clears
chat relationships.

The automation composer remembers model, reasoning effort, service tier, and
Web search as defaults for the next new definition. Editing an existing
automation hydrates that definition's own stored settings instead. Enabled Web
search is visible beside the scope picker and can be disabled directly without
reopening the menu. [[apps/web/src/lib/ai/automation-settings.ts]] and
[[apps/web/src/components/automations/create-automation-dialog.tsx]] own this
definition-composer behavior. The same dialog exposes the searchable cloud
project selector used by chat composers and renders the chosen project's own
icon and color as a removable chip. The selection persists with the definition;
it is never interpreted as a desktop-local folder capability.
The Automations route preloads the dialog entry after the page commits, keeping
the dependency graph out of unrelated initial routes while allowing the first
open on the Automations page to bypass the lazy Suspense boundary.

## Results and delivery

Automation runs form a durable result inbox with explicit classification, unread state, delivery leases, notifications, and stop conditions.

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
