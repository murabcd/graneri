# Graneri

Graneri turns personal work context into durable notes and assistant-led work while keeping user-visible state recoverable across restarts and runtime changes.

## Assistant language

**Assistant Run**:
A durable attempt by the assistant to answer or act within one chat. It remains the same run while waiting for approval or accepting active-turn input.
_Avoid_: Request, generation, agent job

**Assistant Execution**:
The model-and-tool loop that advances an Assistant Run and yields rich assistant-message state.
_Avoid_: Stream, completion, background job

**Producer**:
The runtime currently responsible for advancing an Assistant Run. A run has exactly one Producer at a time.
_Avoid_: Host, worker, owner

**Follow-up**:
User input durably waiting for acceptance by the current Assistant Run or replay after that run finishes.
_Avoid_: Pending message, buffered prompt, queued run

**Stored UI Message**:
The canonical durable form of a rich chat message, including its role, message parts, and optional metadata.
_Avoid_: Chat payload, message JSON, transcript row

## Calendar language

**Calendar Snapshot**:
The last complete, trustworthy set of calendar sources and events for a defined scope. It remains authoritative through transient refresh failures and is cleared only when that scope is explicitly left or disconnected.
_Avoid_: Partial agenda, temporary calendar result

**Calendar Scope**:
The workspace, account identity, provider visibility and connection state, and time interval for which a Calendar Snapshot is valid. Home-day and Agenda-window scopes are distinct.
_Avoid_: Global calendar state, unscoped calendar cache
