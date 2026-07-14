# Share assistant execution across producers

Graneri uses one producer-neutral assistant-execution implementation for AI SDK message validation, the model-and-tool loop, approval detection, and terminal outcome classification. Web and Convex remain separate adapters because desktop-local tools require a live web stream while normal hosted runs require Convex durability and transactional state; keeping two complete execution implementations would make behavioral drift more likely than adapter-specific complexity.

## Consequences

Producer adapters retain their own liveness checks, persistence cadence, delivery, scheduling, and transaction semantics. Shared execution code must not import Convex server modules or desktop-local implementations.
