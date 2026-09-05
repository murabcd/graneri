# Renderer

The renderer presents Graneri in browsers and Electron while delegating durable, native, and provider-specific behavior to deeper modules.

- [[notes]] and [[calendar]] own their domain contracts.
- [[assistant-runs]] owns shared chat execution and recovery.
- [[platform]] exposes desktop capabilities without direct global access.
- [[apps/web/src/app/application-navigation-session.ts]]
- [[apps/web/src/hooks/use-renderer-chat-session.ts]]
- [[apps/web/src/hooks/use-renderer-chat-presentation.ts]]
- [[apps/web/src/components/chat/use-chat-turn-presentation.ts]]
- [[apps/web/src/lib/chat-composer-turn-intent.ts]]

## Runtime role

The Vite renderer is shared by desktop and browser, while desktop release correctness includes the renderer's compiled constants.

This is the React renderer for both desktop and browser. Desktop releases still depend on
the Vite bundle, so renderer constants are part of desktop release correctness.
`useRendererChatSession` is the renderer boundary for AI SDK transport, desktop
local-tool handoff, active-run resume, persisted-message reseeding and merging,
durable follow-up drain and controls, and chat interaction commands. Full chat
and note chat remain view adapters: they provide request-body builders and
presentation callbacks, but must not assemble parallel submit, approval,
regeneration, branch-replacement, stream, recovery, or queue lifecycles.
`use-renderer-chat-presentation.ts` is the active-turn presentation module. It
projects the attachable run, durable plan, persisted and controller messages,
local optimistic messages, interrupted streams, and pending human decision
into one stable renderer snapshot. The interaction session consumes that
snapshot instead of independently reconciling those sources.
`local-capability-run-recovery.ts` owns reattachment to pending desktop-local
tool calls. It claims each run/tool-call pair once per renderer session, builds
the continuation from the run-bound capability rather than current composer
state, executes through Electron, and releases a failed continuation claim so a
later reactive reattachment can retry delivery.

## Application navigation session

One renderer session owns URL state, settings history, desktop synchronization, resource routes, and transient navigation intent.

The application navigation session is the authoritative renderer boundary for
URL-derived route state, settings history restoration, desktop and popstate
synchronization, pinned-inbox behavior, transient note-capture intent, and
workspace-scoped resource-route resolution. The authenticated shell invokes
typed navigation methods and renders the resolved snapshot; it must not mutate
parallel route state cells or write browser history directly.

## Desktop permission session

The renderer owns permission presentation and transitions, while Electron owns native probing and failure classification.

The desktop permissions session is the renderer authority for loading and
refreshing native permission status, request and system-settings transitions,
readiness, and onboarding completion. It consumes the narrow platform bridge
and treats a missing bridge as a runtime error; it must not synthesize legacy
permission rows. Native probing, prerequisite ordering, and permission error
classification remain in Electron main behind IPC.

## Chat interaction sessions

Workspace and note chat share one interaction lifecycle for optimistic state, stop ordering, durable follow-ups, and discussion identity.

Renderer chat interaction ownership is shared across workspace and note chat
surfaces. `use-chat-interaction-session.ts` owns request-preparation leases and
atomic optimistic message commit, rollback, and active-branch replacement;
`use-renderer-chat-session.ts` composes that state with AI SDK streaming,
durable queued follow-ups, branch persistence, stop arbitration, and intent-level
submit, queued-edit, approval, delete, and regenerate commands. Prepared
operations release their lease on both success and failure, optimistic submit
rollback stays inside the session, and pending branch replacement is reconciled
before persisted messages enter the controller. Persisted/external/local stop
ordering enters through `chat-interaction-session.ts`. Chat surfaces provide
request-body and presentation adapters, but must not maintain parallel pending,
optimistic-message, queued-edit, or branch-replacement state.
[[apps/web/src/lib/queued-chat-session.ts]] owns the shared chat-scope
send reservation, accepted-input identity, manual replay handoff, and steer
presentation. Acceptance stays attached to that request when reactive rows
disappear. [[apps/web/src/hooks/use-queued-follow-ups.ts]] composes presentation,
row controls, and preferences. [[apps/web/src/lib/queued-chat-sessions.ts]]
retains that owner while a view or app dispatcher uses it; leaving a view does
not release another consumer's send reservation. Manual and automatic sends
share the same reservation, and last-consumer cleanup releases the scope.
[[apps/web/src/app/queued-chat-runtime.tsx]] owns automatic FIFO dispatch for
all authenticated workspaces independently of the selected view. It discovers
chats through bounded cursor pages and observes each chat's atomically eligible
head. [[apps/web/src/hooks/use-automatic-queued-replay.ts]] starts one client per
head, rechecks eligibility after token preparation and backs off transient
failures. Convex claims fence competing windows and manual sends.
[[apps/web/src/hooks/use-workspace-chat-client.ts]] constructs the shared AI SDK
client and desktop-local tool callbacks for visible and background requests.
Each in-flight request retains those callbacks across view unmounts. A local
continuation resolves the current run and generation, retains its capability,
and removes consumed queue routing before sending tool output. No view-local
automatic dispatcher remains.
`chat-composer-turn-intent.ts` owns the recoverable commit boundary above those
commands. It prepares one semantic turn, chooses queued-edit or new-turn
submission, runs request-prepared effects, fences stale queued edits, and
restores the captured draft and attachments on current-intent failure.
[[apps/web/src/lib/send-shortcut.ts]] resolves keyboard sends for both composers.
For a new active follow-up, Command/Ctrl+Enter in Enter mode or
Command/Ctrl+Shift+Enter in Command Enter mode inverts the saved Queue/Steer
preference for that submission. The explicit override travels through the
composer intent and server admission callback; it never changes preferences or
becomes replay context. Idle chat, queue editing, IME, Alt and newline handling
retain normal send behavior. Button submission follows the saved preference;
Queue remains the default.
Failed optimistic queue deletions restore through the shared
[queued-message-position policy](../packages/ai/src/queued-message-position.mjs):
next neighbor first, then previous neighbor, then the bounded original slot.
The snapshot captures neighbor IDs before hiding the row, so rollback respects
later reorder and removal operations without restoring an old whole-queue order.
Queue admission captures ready uploaded files through [[apps/web/src/lib/chat-queue.ts]];
editing restores those same files into the existing attachment chips in both
chat and note composers. Local previews and upload-in-progress state never enter
the durable queue.
Workspace and note composers retain their distinct recipe, mention, note
context, panel, and focus adapters; they must not reconstruct this commit and
rollback ordering. Both surfaces retain the initiating user message as the
turn's scroll anchor so a short exchange remains visible while longer streamed
answers grow below it. The compact note chat restores its viewport from the
latest turn anchor instead of opening at the transcript's bottom edge and keeps
that anchor stable while the answer grows; readers can scroll or jump to the
latest content explicitly.
The shared `use-chat-turn-presentation.ts` module projects normalized messages
into turn-level render snapshots and materializes one expanded, continuously
timed `Working for N` activity group as soon as an active assistant turn exists.
The group is owned by the logical turn rather than by a synthetic or persisted
assistant message. Its render identity remains stable while the real assistant
message arrives, across the request-to-persisted-run handoff, and when
`Working` becomes `Worked`; those transitions update the existing row without
removing, reparenting, or remounting it. A temporary idle transport status does
not end the visual run before meaningful assistant output arrives, including
when an empty persisted assistant shell or reasoning placeholder lands during
the handoff.
Empty assistant messages create no scroll row, the work group reserves no
answer spacing, and its automatic `Working` to `Worked` transition closes
details without a height animation. The ordinary turn gap appears only when a
final answer actually renders.
A fresh chat also retains its draft composer identifier through first
persistence so the keyed chat page is not remounted during the route replace;
only an explicit New chat action allocates the next draft identifier.
[[apps/web/src/lib/assistant-turn-sequence.ts]]
uses the OpenAI Responses text-part `providerMetadata.openai.phase` contract to
keep commentary, reasoning, and tool calls in their original source order while
separating `final_answer` text from agent activity. Commentary, reasoning, and
tool calls append inside that single open group. Each incoming message snapshot
replaces that message’s activity once it covers at least the previously observed
parts, so inserted parts cannot leave duplicate rows at their old positions.
Shorter hydration snapshots and temporarily absent continuation messages retain
the previously visible activity. When the first final-answer part arrives,
the same group becomes
`Worked`, freezes its timer, and collapses ahead of the still-streaming final
answer. Consecutive
reasoning and tool parts may share an activity subgroup, but an intervening
commentary part always splits them. The separator stays attached directly below
the `Working` or `Worked` row even while its activity is expanded; nested tool
rows do not render their own elapsed durations.
[[apps/web/src/components/chat/message-list.tsx]]
renders that projection; reasoning remains a nested `Thinking` or `Thought`
disclosure and Streamdown renders each text part independently without owning
event ordering, activity grouping, or transport buffering.
Chat message rows do not render a per-message source-count disclosure; source
metadata remains available through the chat summary. Streamdown code fences use
the shared Graneri code renderer: their vertical height is content-driven, their
outer width remains fixed to the message column, and a local control switches
between wrapped lines and horizontal scrolling while locking the rendered frame
to its pre-toggle dimensions. The
outer code frame uses the chat composer radius while its header and body have no
internal separator; the 48-pixel header owns the action row with a 6-pixel
vertical inset, and the body starts after the header without Streamdown's sticky
negative-margin overlap. Header actions use 32-pixel hit areas with 16-pixel
Lucide glyphs and retain a balanced inset from the right edge. Fenced code is
tokenized by Streamdown's lazy Shiki code plugin with the
`Graneri Light` and `Graneri Dark` theme registrations; highlighting enriches
the existing code body without
changing its content-driven geometry or wrap state.
Streamdown remains the incremental Markdown parser, but it does not own chat
typography: semantic element renderers remove its presentation classes and the
shared Markdown root and note editor use the semantic prose contract in
[apps/web/src/styles/prose.css](../apps/web/src/styles/prose.css), while
[apps/web/src/styles/chat-markdown.css](../apps/web/src/styles/chat-markdown.css)
owns only the Streamdown boundary and chat-specific code presentation. The shared
Markdown renderer also handles expanded `Thinking` and `Thought` summaries in
[[apps/web/src/components/ai-elements/reasoning.tsx]], preserving their muted
color and bounded scroll area while parsing streamed and completed Markdown.
The shared
contract applies the Graneri 14-pixel type scale,
1.625 line height, compact heading ratios, paragraph rhythm, list indentation,
blockquote rail, and inline-code treatment. Its final top-level Markdown block
always has zero bottom margin so element-specific prose rhythm cannot leak into
the message-to-actions gap.
Active streamed text has one display cadence: [[apps/web/src/lib/frame-budgeted-chat-transport.ts]]
releases transport chunks on animation frames, React consumes those updates
without an additional time throttle, and [[apps/web/src/components/chat/markdown-stream.tsx]]
enables Streamdown's word-level entrance animation while `isAnimating` is true.
The animation stylesheet is loaded once by
[apps/web/src/index.css](../apps/web/src/index.css) and the shared reduced-motion
preference collapses its duration. Completed and static Markdown use the same
renderer without animated word wrappers.
Ask AI and note discussions also share
[[apps/web/src/components/chat/message-actions.tsx]]. Assistant content and user
bubbles both use the same compact 4-pixel external actions offset. The user
bubble's internal padding intentionally remains part of its larger text-to-actions
distance, while unboxed assistant prose stays closer to its controls. Every
action uses the same 2-pixel control gap, icon button, and tooltip contract.
Surface-owned actions such as `Create note` and `Add to note` plug into that
shared row rather than recreating its layout.
Note-scoped discussion ownership is layered on top of the shared renderer
interaction session by `use-note-discussion-session.ts`. It owns draft/stored
chat identity, note chat list/session/run snapshots, cursor-paginated messages, selector
grouping, title/loading derivation, and the same required five-field chat
settings snapshot used by workspace chat. The note surface exposes model,
reasoning, and speed controls while retaining the note chat's mode and web-search
values in every request. The note composer owns only editor, attachment,
transcript, focus, and panel-presentation adapters; it must not reproduce
discussion identity, settings ownership, or query orchestration.
[[apps/web/src/components/note/note-composer-footer-ui.tsx]] owns the shared
footer layout tokens and the inline composer's focused attachment, editor, and
action rows, keeping those render branches out of the note session adapter.
Workspace chat navigation commits the destination route immediately and lets the
destination's cursor-paginated subscription load its first bounded page. The workspace composer derives its
placeholder from the stored chat identity before hydrated messages arrive, so a
known chat shows follow-up copy from its first destination render while a true
draft chat keeps the general prompt.

## Workspace chat project selection

One renderer hook keeps cloud project identity stable across draft creation, stored-chat navigation, and explicit reassignment.

[[apps/web/src/hooks/use-chat-project.ts]] separates the nullable project
relationship from remembered chat settings. A draft workspace chat starts
without a project, the selected project travels with the accepted request, and
a stored chat's persisted `projectId` wins when that chat is opened again.
[[apps/web/src/components/ai-elements/composer-project-picker.tsx]] supplies the
shared searchable selector used by chat and automation composers. The active
chip renders the project's configured icon and color, while the generic picker
entry uses a neutral closed-folder icon. Desktop-local folder selection remains
a separate database-labelled option because it grants a process-local
capability rather than cloud resource ownership.
