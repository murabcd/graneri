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
`convex/resourceRetirement.ts` owns permanent note and chat retirement policy:
bounded collection batches, progress reporting, idempotent retries, and
continuation scheduling for note-, workspace-, owner-, and trash-scoped
removal. Note and chat feature modules expose record-specific retirement
adapters, but callers must enter through the resource-retirement boundary and
must not reproduce record ordering or retry loops.

## Hosted auth configuration

Missing hosted OAuth credentials reject configuration instead of substituting placeholders.

Hosted auth provider configuration is fail-closed: missing OAuth
provider credentials must reject configuration instead of substituting
placeholder client ids or secrets.
