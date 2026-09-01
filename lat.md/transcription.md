# Transcription and Meeting Capture

Transcription modules own note capture, global dictation, realtime transports, native audio separation, auto-stop state, and desktop meeting detection.

- [[notes]] consumes captured transcript state.
- [[desktop-runtime]] owns Electron lifecycle around native helpers.
- [[apps/web/src/lib/note-transcript-capture-session.ts]]
- [desktop transcription runtime](../apps/desktop/src/desktop-transcription-runtime.mjs)

## Note transcript session

One renderer module serializes note capture identity, hydration, utterance persistence, scope replacement, and system-audio claims.

Note transcript capture lifecycle is owned by
`apps/web/src/lib/note-transcript-capture-session.ts`. It serializes session
identity, concurrent starts, draft/server hydration precedence, queued and
deduplicated utterance persistence, capture-scope replacement, and system-audio
mode persistence claims. React effects in `use-note-transcript-session.ts`
adapt this lifecycle to route scope, Convex repositories, and desktop capture;
they must not recreate temporal ownership with parallel refs.

## Stored transcript loading

Stored transcript metadata, canonical text, and utterance history have separate loading boundaries.

[[convex/transcriptSessions.ts]] returns the latest session's status, language,
timestamps, transcript availability, and utterance count without reading or
returning the transcript body. Canonical completed text lives in
[[convex/transcriptDocument.ts]] and is read only by explicit generation or
template-rewrite actions. Terminal sessions with captured utterances require
that document and fail closed when it is unavailable; only active capture
assembles its current utterances on demand. The transcript panel reads
`transcriptSessions.listUtterances` in chronological cursor pages of 50 and
offers another page only when one exists. Active capture recovery drains every
page before publishing a recovered snapshot so a partial history can never
replace the local draft. Completed history remains demand-loaded, while live
capture continues to render its local latest tail. Copy stays disabled until
all visible history pages are loaded; note generation requests the complete
canonical text server-side and never treats a renderer page as the full source.

## Desktop-only live transcription

Packaged macOS transcription requires the desktop controller and never falls back to browser capture.

On macOS, live transcription must use the desktop transcription controller. It
must not silently fall back to the browser transcription controller when the
packaged desktop bridge is missing or stale.

## Global dictation

Electron owns hotkeys, microphone capture, bounded temporary audio, authenticated transcription, cancellation, and paste into the focused app.

Global dictation is a desktop-native capability, not a renderer textarea
feature. The desktop runtime owns the global hotkey monitor, microphone capture,
buffered OpenAI transcription, and system paste into the focused app. Renderer
code must not duplicate dictation capture or expose route-level fallbacks for
this path. The renderer may select the persisted global dictation hotkey mode
through the desktop bridge; Electron applies hold, toggle, or disabled mode by
restarting the native hotkey monitor without restarting the app.
Global dictation sends at most 19 MB of temporary WAV audio through the
authenticated desktop local-server route to one Convex HTTP action. That action
rate-limits the authenticated identity, stores the audio, schedules an
idempotent expiry before invoking the internal OpenAI transcription action, and
attempts immediate deletion when the request finishes. The scheduled cleanup is
the durable guarantee when a request or action is interrupted. There is no
client-visible generated-upload or registration lifecycle. The OpenAI request
uses the same SHA-256 safety identifier policy as realtime transcription.
Voice transcription does not use the Vercel AI SDK or the official OpenAI SDK:
dictation calls `gpt-transcribe` through direct OpenAI REST, realtime session
creation uses direct OpenAI REST, and live audio uses OpenAI WebRTC or
WebSocket. The Vercel AI SDK remains the shared orchestration layer for
non-transcription AI workflows.

## Realtime authentication and model

Every realtime session uses a fresh short-lived secret, a hashed safety identity, explicit transport settings, and bounded reconnects.

Desktop realtime transcription obtains its short-lived OpenAI client secret
from the authenticated hosted Vercel route through the desktop local server.
The hosted route rate-limits the authenticated identity and sends OpenAI a
SHA-256 hash of the stable Convex token identifier as
`OpenAI-Safety-Identifier`; the raw identity never leaves Graneri's server
boundary. Realtime sessions use `gpt-live-transcribe` with 24 kHz PCM input,
`high` transcription delay, and plural language hints. Browser WebRTC sessions
use OpenAI server VAD; native WebSocket sessions disable turn detection because
Electron commits audio buffers explicitly. Because the model does not expose
transcription logprobs, turn acceptance must depend on transcript state and
placeholder guards rather than a client-side confidence layer. Realtime
recovery is bounded to three reconnect attempts with 750 ms, 1.5 s, and 3 s
backoff. Each attempt must request a fresh short-lived secret. Electron must
never call OpenAI with a long-lived API
key or embed that key in a build.
While a dictation capture is active, Electron owns a temporary global Escape
shortcut that cancels capture and discards buffered audio without transcribing
or pasting it. The idle dictation bar is suppressed when dictation hotkeys are
disabled, even if its persisted visibility preference remains enabled.

## Session rollover and audio commit

Long-lived capture schedules rollover and explicitly commits only non-empty native audio buffers.

Desktop realtime transcription is a long-lived native capture session. Starting
the microphone transport must schedule the realtime session rollover, and
the native transport must explicitly commit non-empty OpenAI input audio
buffers during live capture. Empty-buffer commits are not a valid path; they
create recoverable-looking OpenAI errors that can collapse into start/stop
loops.

## Per-speaker runtime

One runtime owns speaker transport state, transcript projection, ordered turns, interrupted-tail salvage, and initial session shape.

`desktop-transcription-runtime.mjs` owns the per-speaker transport state, live
transcript projection, ordered turn emission, interrupted-tail salvage, and
initial renderer session shape. Electron `main.mjs` orchestrates permissions,
native capture, reconnects, and IPC around that runtime; it must not maintain a
second set of speaker turn maps or interpret realtime transport events itself.

## Native audio separation

The combined native pipeline uses synchronized system audio as the echo reference while preserving microphone and remote sources.

Desktop meeting audio must preserve two distinct sources: microphone audio is
the `you` source, and native system audio is the `them` source. Built-in speaker
routes may need echo/leakage suppression so remote speech does not bleed into
the microphone stream and get labeled as `you`, but that suppression must not
duck or lower the user's meeting audio. Headphone routes should not enable
microphone voice-processing or echo-cancellation paths because there is no
speaker playback to suppress. The target architecture is a combined native
capture pipeline: capture microphone and system audio with synchronized timing,
use system audio as the echo-cancellation render/reference for the microphone
stream, emit cleaned microphone audio as `you`, and emit raw system audio as
`them`. Apple voice processing is a route-scoped stopgap, not the long-term
source-separation mechanism.
The combined helper must disable Apple microphone voice processing and own echo
reduction itself, because Apple processing can alter the user's local meeting
volume and obscure which source caused attenuation.

## Native helper protocol

A stable newline-delimited protocol carries source-tagged audio and bounded diagnostics around correlation-gated AEC3 processing.

Native audio helpers communicate with Electron over newline-delimited JSON.
`ready`, `chunk`, `error`, and `stopped` are the only helper event families.
Separate microphone and system-audio helpers infer source from the process that
emitted the event. A combined helper must emit the same `chunk` shape plus a
`source` field set to `microphone` or `systemAudio`, allowing Electron to keep
the speaker contract stable while the native process owns synchronized capture
and echo-cancellation reference timing. The combined helper binary is the
native integration point for echo reduction. Its microphone path must flow
through the combined audio processing pipeline, and that pipeline must use
system audio as the render/reference signal before microphone audio is emitted.
Echo reduction must be correlation-gated: active system audio alone is not a
reason to subtract from the microphone stream, because local-only speech during
remote playback must pass through unchanged. After AEC3 runs, the microphone
path applies one source-attribution gate: if system audio is active and the
post-AEC microphone energy is below the local-speech floor, that residual is
silenced before it can be emitted as `you`. Double-talk above that floor must
remain in the microphone stream.
The combined helper's ready event must report the audio processing stage so
diagnostics can tell whether microphone output is waiting for render reference
or actively reducing echo.
`bun --filter=desktop run diagnose:meeting-audio -- --play-system-sound` is the
local smoke test for this boundary. It starts the combined helper, plays a short
system sound, and reports only route metadata, source chunk counts, and bounded
processing diagnostics. It must not print or persist raw PCM.

## Auto-stop state

Renderer auto-stop behavior is explicit state and cannot inherit stale meeting signals across notes.

Meeting-controlled and idle-controlled automatic stops must be modeled as
explicit transcription auto-stop state in the renderer, not scattered hook
refs. A newly auto-started note must not inherit stale meeting-detection state
from a previous note or from a pre-listening meeting signal.

## Meeting detection

Electron owns signal aggregation, prompts, suppression, panel visibility, and actions while the renderer consumes one aggregate state.

Desktop meeting detection owns its signal inputs in Electron. Calendar
candidate selection, native microphone activity clients, source normalization,
debounce, dismissal, suppression, and widget window visibility stay in
`apps/desktop`; the renderer receives an aggregate meeting-detection state and
may render it or send user actions back through `packages/platform`. Renderer
code must not inspect running applications, microphone activity, calendar state,
or desktop windows directly to decide whether a meeting exists.
Meeting prompts and scheduled calendar reminders intentionally use a
desktop-owned custom notification-like window rather than OS notification
delivery. On macOS this surface must be a panel-style window hidden from Mission
Control, kept out of the task switcher, and visible across spaces/full-screen
contexts. The custom surface is part of the desktop meeting state machine:
Electron owns prompt debounce, scheduled-reminder de-duplication, dismissal,
suppression, full-screen/workspace visibility, and action handling so the prompt
remains predictable under Focus modes, Notification Center settings, and
transcription state changes.
