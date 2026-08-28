# Renderer

The renderer presents Graneri in browsers and Electron while delegating durable, native, and provider-specific behavior to deeper modules.

- [[notes]] and [[calendar]] own their domain contracts.
- [[assistant-runs]] owns shared chat execution and recovery.
- [[platform]] exposes desktop capabilities without direct global access.
- [[apps/web/src/app/application-navigation-session.ts]]
- [[apps/web/src/hooks/use-renderer-chat-session.ts]]

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
The shared [[apps/web/src/components/chat/message-list.tsx]] renderer owns one
monotonic activity phase per active turn: it begins with the generic `Thinking`
placeholder, crosses to `Working` when reasoning or a renderable tool first
appears, and cannot return to the generic placeholder before the turn ends even
if a transient stream snapshot has no work parts. Reasoning remains a nested
`Thinking` or `Thought` disclosure inside that turn-level work group.
Note-scoped discussion ownership is layered on top of the shared renderer
interaction session by `use-note-discussion-session.ts`. It owns draft/stored
chat identity, note chat list/session/run snapshots, prefetching, selector
grouping, title/loading derivation, and model/reasoning persistence. The note
composer owns only editor, attachment, transcript, focus, and panel-presentation
adapters; it must not reproduce discussion identity or query orchestration.
Workspace chat navigation commits the destination route immediately while
message prefetch continues independently. The workspace composer derives its
placeholder from the stored chat identity before hydrated messages arrive, so a
known chat shows follow-up copy from its first destination render while a true
draft chat keeps the general prompt.
