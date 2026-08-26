# Calendar

Calendar modules normalize Google and Yandex behavior while keeping credentials, provider authorization, and writes on the server.

- [[notes]] consumes normalized event and attendee snapshots.
- [[convex/calendarProviderModule.ts]]
- [[apps/web/src/components/calendar/calendar-snapshot-module.ts]]

## Provider and calendar ownership

One provider module aggregates complete snapshots and dispatches provider-neutral commands while adapters retain wire protocols and credentials.

The calendar page reads and creates events and provider calendars through
authenticated Convex actions. Provider credentials and write requests remain
server-side. `calendarProviderModule` owns provider selection, parallel
complete-snapshot aggregation, deduplication, provider-neutral command
normalization, and write dispatch; public Convex actions remain authenticated
adapters, while Google and Yandex implementations own their credentials and
wire protocols. Google event creation uses the calendar event scope; real
secondary calendar creation, metadata changes, and owned-secondary deletion
use the calendar-management scope, while calendar-list color/alias changes
and subscription removal use the calendar-list scope. Yandex creates
event-only collections with CalDAV MKCALENDAR and writes VEVENT resources with
CalDAV PUT. Calendar sources expose server-derived edit and removal
capabilities. Google primary calendars are editable but not removable, owned
secondary calendars are deleted, and non-owned entries are removed from the
user's CalendarList. Yandex default collections are editable but not deletable;
other writable collections with property-write access are removable. Yandex's
CalDAV service does not consistently expose the parent `unbind` privilege even
when the authenticated user can delete those collections, so the provider
DELETE remains the authoritative removal check. Destructive calendar deletion
requires another writable calendar on the same provider. Graneri preflights the
source, moves all resources, and deletes the provider calendar only after the
moves complete; Google subscription removal does not move or delete the owner's
events. Provider-default calendar
changes remain unsupported for Google because it does not expose a primary
calendar switch. Yandex exposes its real default through the RFC 6638
`schedule-default-calendar-URL` property on the scheduling inbox; Graneri reads
that property when building the source snapshot, updates it with CalDAV
PROPPATCH, and re-reads it before reporting success.

## Occurrence authorization

Every occurrence mutation reloads provider state and rechecks distinct edit, guest, delete, removal, and move authority server-side.

Event updates and deletes target the selected occurrence: Google
uses its instance event identifier, while Yandex writes an iCalendar
`RECURRENCE-ID` override or cancellation back to the original resource with
ETag protection. Event snapshots expose separate provider-derived full-edit,
guest-list, delete, attendee-removal, and calendar-move capabilities. Guest-list
permission is an explicit `none`, `invite`, or `manage` mode. Google
permits full editing for the organizer, creator, delegated non-primary calendar
writer, or an attendee
explicitly allowed to modify the event; delete-for-everyone is limited to the
organizer, creator, or delegated calendar writer. Yandex permits full event
changes for organizer-owned or organizerless personal events in a collection
whose CalDAV ACL includes write access. Google attendees may receive additive
invite permission without receiving full-edit or delete authority. Yandex
attendees with participant editing may manage the guest list without receiving
full event-edit or delete authority. `yandexCalendarEventAuthority` is the
single policy owner for both snapshot capability projection and refreshed write
authorization; parser and transport code provide provider facts without
reinterpreting organizer or attendee rules. Every mutation reloads the provider
event and rechecks that authorization server-side; renderer capability flags
are presentation data, not trusted authorization. Google invite-only requests
retain all existing participants. Yandex guest-management requests preserve the
current attendee's membership while applying the requested guest set. Both
ignore client-supplied changes to the event title, description, time, and
location.

## Guest, cancellation, and move operations

Guest management, cancellation, attendee removal, and provider calendar moves remain distinct commands with independent capabilities.

Guest edits preserve retained provider attendee metadata such as response
state, and provider writes notify guests. Cancellation-for-everyone, attendee
removal, guest-list management, and calendar moves are distinct provider
operations and capabilities. Google
attendees remove their own event copy, while Yandex attendees decline the whole
invitation with CalDAV scheduling headers or decline one recurring occurrence
with an `EXDATE`; neither operation cancels the organizer's event. Organizer
calendar moves are limited to writable calendars on the same provider. Google
uses `events.move` and therefore applies Google's organizer-transfer semantics;
Yandex moves the VEVENT resource between writable CalDAV collections. Moving a
recurring event moves the whole series, even when the editor was opened from one
occurrence. Google default events with at most 200 attendees and Yandex
organizer-owned events expose move capability. Every move destination and every
attendee-removal request is re-authorized server-side. The renderer receives
explicit provider identity, opaque provider event identity, provider-owned
calendar color, per-calendar write capability, separate edit, guest permission,
cancel, remove, and move capabilities, and normalized recurrence identities; it
offers only same-provider writable destination calendars while editing.

## Recurrence

Creation uses one normalized recurrence contract with IANA time zones and provider serialization that preserves local wall time.

New-event creation supports daily, weekly, monthly, and yearly recurrence with
an interval, explicit weekly weekdays, and never/on-date end
conditions. The renderer sends the user's IANA time zone with that normalized
recurrence contract. The server canonicalizes the zone, validates numeric and
date bounds, orders weekly days, and provider adapters serialize one standard
RRULE so Google and Yandex preserve the intended local wall time through
daylight-saving changes. Recurrence controls are intentionally absent from
occurrence-scoped editing until whole-series recurrence editing has a separate
provider contract.

## Complete snapshots

Calendar reads are complete snapshots with coalescing, generation-fenced invalidation, retained successful data, and shared projections.

Provider reads are complete-snapshot operations: a
failed calendar read rejects the refresh instead of caching a partial agenda,
so the renderer retains the last successful snapshot while provider reads and
writes refresh. `calendarSnapshotModule` is the renderer authority for
workspace-scoped Calendar Snapshot persistence, request coalescing, provider
source changes, and generation-fenced invalidation. Agenda windows and Home-day
windows remain distinct Calendar Scopes inside that module; Agenda, Home, and
the desktop tray consume projections of those snapshots instead of maintaining
parallel caches or optimistic event copies. Successful writes invalidate every
persisted snapshot for the workspace, retain the currently rendered complete
snapshot during refresh, and discard responses from older generations. Detail
updates followed by a calendar move are necessarily sequential provider calls;
update attempts invalidate snapshots even on failure so a completed first call
is never hidden behind stale renderer state.
Adjacent Agenda windows are prefetched through the same lifecycle.
