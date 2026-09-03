# Convex Backend

Convex owns authenticated durable state, server integrations, shared access control, and bounded resource retirement.

- Read [Convex generated guidelines](../convex/_generated/ai/guidelines.md) before changing backend functions, schema, auth, or HTTP routes.
- [[convex/resourceRetirement.ts]]
- [[assistant-runs]] and [[automations]] build durable lifecycles on this backend.

## Authorization and resource retirement

Server-derived identity and shared access guards protect every resource, while one retirement module owns bounded permanent deletion.

Convex contains server functions, schema, HTTP actions, auth, and server-only integrations.
Read `convex/_generated/ai/guidelines.md` before changing Convex code. Convex
derives ownership from server-side identity; client arguments may select
resources such as workspace or chat ids, but they must not be trusted as owner
identity. `convex/domain.ts` owns the shared access-control primitives for
queries, mutations, and actions. Feature modules configure their resource label
through `createResourceAccess` and use the canonical workspace ownership guard;
they must not define local authentication or workspace ownership wrappers.
`convex/resourceRetirement.ts` owns permanent note and chat retirement plus
project-relationship cleanup policy: bounded collection batches, progress
reporting, idempotent retries, and continuation scheduling for note-, project-,
workspace-, owner-, and trash-scoped removal. Project deletion atomically
removes the project and schedules independent active-note, archived-note,
active-chat, archived-chat, and automation detachment jobs. Note and chat
feature modules expose record-specific retirement adapters, but callers must
enter through the resource-retirement boundary and must not reproduce record
ordering or retry loops.

## Hosted auth configuration

Missing hosted OAuth credentials reject configuration instead of substituting placeholders.

Hosted auth provider configuration is fail-closed: missing OAuth
provider credentials must reject configuration instead of substituting
placeholder client ids or secrets.

## Settings image uploads

Profile avatars and workspace icons share one authenticated, owner-bound upload lifecycle with strict image validation and bounded pending storage.

[[convex/settingsImageHttp.ts]] accepts JPEG, PNG, WebP, and GIF bytes up to
5 MiB, validates the declared media type against the file signature, stores the
blob, and registers it through [[convex/settingsImageUploads.ts]]. Pending rows
expire after one hour and can be explicitly discarded when a settings form is
cancelled or its selection is replaced. [[convex/userPreferences.ts]] and
[[convex/workspaces.ts]] consume the purpose-specific pending row in the same
mutation that replaces the durable storage reference, then delete the previous
avatar or icon. The client enters only through
[[apps/web/src/lib/settings-image-upload.ts]]; the former profile- and
workspace-specific signed-upload endpoints are not retained.
