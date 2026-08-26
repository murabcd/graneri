# Notes

Note modules own one canonical Tiptap document format, serialized persistence, editor behavior, file references, and meeting relationships.

- [[calendar]] supplies immutable event and attendee snapshots.
- [[transcription]] supplies ordered transcript capture.
- [[apps/web/src/lib/note-table.ts]]
- [[convex/noteDocument.ts]]

## Document session and persisted format

The note document session is the only writer and stores fail-closed canonical Tiptap JSON after explicit ingestion conversion.

The note document session is the authoritative module for note hydration, local
draft recovery, remote reconciliation, debounced saves, per-note in-flight save
serialization, and flush-on-navigation behavior. The note page remains a view
adapter: it projects session documents into Tiptap and must not rebuild save or
draft ordering with local effects and refs. Persisted note content has one
fail-closed format: canonical Tiptap document JSON. Markdown paste, import, and
chat-response capture are explicit ingestion paths that convert to that format
before saving; stored-content readers do not repair Markdown, malformed JSON,
unowned images, or legacy document shapes.

## Editor images

Open-source Tiptap extensions own insertion and resizing while Graneri owns authenticated upload, metadata, toolbar, and caption behavior.

The note editor's `/` command menu uses Tiptap's open-source suggestion,
list/task, table, horizontal-rule, and image extensions for block styling and
insertion. Image picker, paste, and drop behavior also use the open-source
file-handler extension. Authenticated binary upload
goes directly to the Convex `/api/note-images` HTTP action; there is no Tiptap
cloud or Vercel Blob storage path. The Tiptap node persists both its display URL
and the canonical `noteImageId`, plus display-only alignment, caption, and width
attributes. Graneri owns the free image toolbar and caption node view; Tiptap's
open-source resizable node view owns drag geometry. Image replacement reuses the
same Convex uploader and updates the selected node in place, while the normal
note document session remains the only writer of note content.

## Table interaction

One table module owns geometry, controls, selection preservation, resizing, movement, and duplication semantics.

`apps/web/src/lib/note-table.ts` is the single table-interaction module. It owns
rendered table geometry, edge-control visibility and drag reversal, column
resize normalization, menu-target lifecycles, selection preservation, and
row/column move and duplication semantics. The Tiptap node view and React menu
portal are rendering adapters over that module; they must not establish
parallel document listeners, hover timers, geometry models, or command paths.

## Calendar-linked relationships

Calendar-linked note creation atomically stores provider snapshots and resolves canonical people, companies, and associations.

Calendar provider adapters also return a normalized attendee snapshot for every
event: canonical lowercase email, display name, organizer/self flags, and
response status. Repeated iCalendar `ATTENDEE` properties must remain distinct
through parsing before normalization. Creating a calendar-linked note is one
Convex transaction that stores the immutable event/attendee snapshot, resolves
workspace-scoped people by email, resolves companies by non-personal business
email domain, and creates the note-to-person and note-to-company associations.
`companyDomain` owns canonical Company creation, domain-aware search, and
orphan cleanup; note relationships own atomic association persistence, while
meeting search owns result composition.
Archiving mirrors state onto those associations for indexed reads; permanent
deletion removes the associations and any now-orphaned canonical identities.
An invalid attendee or an event above the supported attendee bound rejects the
whole note creation instead of persisting a partial relationship snapshot.

## File storage and document saves

Convex File Storage owns note image bytes, and every save validates one canonical document before synchronizing references and revisions.

Convex File Storage is the sole owner of note image bytes. `noteImages` binds
each blob to its server-derived owner, workspace, and note; current documents
and retained `noteRevisions` hold explicit `noteImageReferences`. Every note
save enters through `convex/noteDocument.ts`, which parses and validates the
canonical document once, then supplies the same derived image references and
comment anchors to the transactional save. Malformed documents and invalid
table geometry fail before note state is changed. Every save validates image
ids and synchronizes the current reference set, revision
creation and pruning synchronize revision references, and permanent note
retirement removes all remaining bytes. An uploaded image that never reaches a
saved document is removed by its scheduled one-hour pending-upload cleanup.

## Transcript-driven generation

Transcript language and content remain authoritative through initial generation and template rewrites, committed through the document session.

Each transcript session stores the live transcription language selected when
capture starts. Explicit languages are reused for initial note generation and
every later template rewrite; Auto-detect remains unpinned and lets the model
follow the stored transcript. Template application also treats that transcript
as the authoritative source for language and facts, so template changes do not
compound a previous generated rewrite. The complete rewrite is structurally
validated before note content is emitted. Generated content and its template
slug are then committed in one `notes.save` mutation, so a failed generation or
save leaves the existing note and template selection intact. Renderer generation
and template rewrites enter that mutation through the same note document session
as autosave; commit metadata carries the template slug so one serializer owns
ordering for every document write. Note UI code must not bypass the document
session with a competing direct save.

## Project description generation

Project description context is bounded, project-scoped, authorization-aware, and selected from either notes or the previous description.

Project description generation reads its note context through the
project-scoped `projectDescriptions.getContext` query. The query uses the
project note index to return at most 20 non-archived notes ordered by most recent
update, so context selection is independent of the workspace note-list limit.
If a project disappears while that reactive query is being invalidated, it
returns empty context after workspace authorization instead of surfacing an
expected teardown error; project mutations continue to fail closed when the
project is missing.
When note context exists, it is the authoritative description source and the
previous description is omitted; without notes, the previous description is
used as the rewrite source. Requests without either source are rejected before
model generation.
