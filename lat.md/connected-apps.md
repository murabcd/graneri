# Connected Apps

Connected-app modules own capability identity, selected scope, tool assembly, credential protection, provider failures, and renderer connection lifecycle.

- [[assistant-runs]] consumes the assembled tool catalog.
- [capability metadata](../packages/ai/src/capability-metadata.mjs)
- [[apps/web/src/components/settings/use-connected-app-settings-session.ts]]

## Workspace capability selection

Meeting knowledge is always available, interactive app selection exposes every enabled connection, and automations keep explicit source scope.

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

## Workspace tool catalog

One catalog assembles safe runtime-specific tools, isolates discovery failures, and keeps credentials out of public functions and jobs.

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
The [remote MCP adapter](../packages/ai/src/remote-mcp-tools.mjs) maps every
discovered tool into the shared
[tool-authority module](../packages/ai/src/ai-tool-authority.mjs). A tool is
treated as read-only without approval only when its validated MCP annotation
declares `readOnlyHint: true`; missing or write-capable annotations require
durable user approval before execution. Provider discovery cannot bypass this
classification by supplying presentation metadata alone.

## Capability metadata and adapters

Capability metadata owns provider identity and behavior while the runtime registry requires one adapter per app source.

Connected app AI capabilities are declared in
`@workspace/ai/capability-metadata`. The catalog is the source of truth
for provider identity, source classification, connection and OAuth behavior,
settings identity, source instructions, remote defaults, and tool-discovery
prefixes. `@workspace/ai/capability-registry` attaches runtime-specific
tool adapters to every app-source capability and fails at module load when an
adapter is missing. Desktop-local capabilities such as shared local folders
and native transcription remain desktop bridge APIs, not generic connected-app
capabilities.

## Renderer connection lifecycle

One renderer session owns connection snapshots, provider flows, OAuth navigation, cleanup, and workspace loading.

Renderer connection lifecycle is owned by
`apps/web/src/components/settings/use-connected-app-settings-session.ts`.
Provider views consume its stable connection snapshot and provider-family
sessions; they must not reimplement form reset, OAuth navigation, connection
failure cleanup, or workspace-scoped loading. Remote MCP providers enter through
`use-remote-mcp-connection-session.ts`, while capability identity and defaults
remain authoritative in `@workspace/ai/capability-metadata`.
