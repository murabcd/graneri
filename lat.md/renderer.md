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
`chat-composer-turn-intent.ts` owns the recoverable commit boundary above those
commands. It prepares one semantic turn, chooses queued-edit or new-turn
submission, runs request-prepared effects, fences stale queued edits, and
restores the captured draft and attachments on current-intent failure.
Workspace and note composers retain their distinct recipe, mention, note
context, panel, and focus adapters; they must not reconstruct this commit and
rollback ordering.
The shared `use-chat-turn-presentation.ts` module projects normalized messages
into turn-level render snapshots and owns one monotonic activity phase per
active run lifecycle. It begins with the generic `Thinking` placeholder,
crosses to `Working` when reasoning or a renderable tool first appears, and
cannot return to the generic placeholder before the run ends even if optimistic
and persisted message identifiers reconcile or a transient stream snapshot has
no work parts. [[apps/web/src/components/chat/message-list.tsx]] renders that
projection; reasoning remains a nested `Thinking` or `Thought` disclosure
inside the turn-level work group.
Note-scoped discussion ownership is layered on top of the shared renderer
interaction session by `use-note-discussion-session.ts`. It owns draft/stored
chat identity, note chat list/session/run snapshots, prefetching, selector
grouping, title/loading derivation, and the same required five-field chat
settings snapshot used by workspace chat. The note surface exposes model,
reasoning, and speed controls while retaining the note chat's mode and web-search
values in every request. The note composer owns only editor, attachment,
transcript, focus, and panel-presentation adapters; it must not reproduce
discussion identity, settings ownership, or query orchestration.
Workspace chat navigation commits the destination route immediately while
message prefetch continues independently. The workspace composer derives its
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
