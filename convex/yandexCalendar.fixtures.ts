// Multiple dots keep this test-only module out of Convex deployment entrypoints.
export const connection = {
	email: "owner@example.com",
	password: "app-password",
	serverAddress: "caldav.yandex.test",
	calendarHomePath: "/calendars/owner%40example.com/",
};

export const calendarsResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response>
		<d:href>/calendars/owner%40example.com/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Calendars</d:displayname>
				<d:current-user-privilege-set>
					<d:privilege><d:unbind /></d:privilege>
				</d:current-user-privilege-set>
				<d:resourcetype><d:collection /></d:resourcetype>
			</d:prop>
		</d:propstat>
	</d:response>
	<d:response>
		<d:href>/calendars/owner%40example.com/events-1/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Personal</d:displayname>
				<d:current-user-privilege-set>
					<d:privilege><d:write-content /></d:privilege>
					<d:privilege><d:write-properties /></d:privilege>
				</d:current-user-privilege-set>
				<a:calendar-color>#10B981FF</a:calendar-color>
				<d:resourcetype><d:collection /><c:calendar /></d:resourcetype>
				<c:supported-calendar-component-set>
					<c:comp name="VEVENT" />
				</c:supported-calendar-component-set>
			</d:prop>
		</d:propstat>
	</d:response>
	<d:response>
		<d:href>/calendars/owner%40example.com/todos-1/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Reminders</d:displayname>
				<d:resourcetype><d:collection /><c:calendar /></d:resourcetype>
				<c:supported-calendar-component-set>
					<c:comp name="VTODO" />
				</c:supported-calendar-component-set>
			</d:prop>
		</d:propstat>
	</d:response>
</d:multistatus>`;

export const emptyReportResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" />`;

export const schedulingInboxPath = "/calendars/owner%40example.com/inbox/";
export const schedulingPrincipalResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response><d:propstat><d:prop><c:schedule-inbox-URL><d:href>${schedulingInboxPath}</d:href></c:schedule-inbox-URL></d:prop></d:propstat></d:response>
</d:multistatus>`;
export const schedulingInboxResponse = (defaultCalendarPath: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response><d:propstat><d:prop><c:schedule-default-calendar-URL><d:href>${defaultCalendarPath}</d:href></c:schedule-default-calendar-URL></d:prop></d:propstat></d:response>
</d:multistatus>`;

export const getCalendarMetadataResponse = ({
	calendarsXml = calendarsResponse,
	defaultCalendarPath = "/calendars/owner%40example.com/events-default/",
	init,
	input,
}: {
	calendarsXml?: string;
	defaultCalendarPath?: string;
	init?: RequestInit;
	input: string | URL | Request;
}) => {
	if (init?.method !== "PROPFIND") {
		return null;
	}

	const url = String(input);
	if (url.endsWith("/principals/users/owner@example.com/")) {
		return new Response(schedulingPrincipalResponse, { status: 207 });
	}
	if (url.endsWith(schedulingInboxPath)) {
		return new Response(schedulingInboxResponse(defaultCalendarPath), {
			status: 207,
		});
	}
	if (url.endsWith("/calendars/owner%40example.com/")) {
		return new Response(calendarsXml, { status: 207 });
	}

	return null;
};

export const calendarsWithDestinationResponse = calendarsResponse.replace(
	"\t<d:response>\n\t\t<d:href>/calendars/owner%40example.com/todos-1/</d:href>",
	`\t<d:response>
		<d:href>/calendars/owner%40example.com/events-2/</d:href>
		<d:propstat>
			<d:prop>
				<d:displayname>Work</d:displayname>
				<d:current-user-privilege-set>
					<d:privilege><d:write-content /></d:privilege>
					<d:privilege><d:write-properties /></d:privilege>
				</d:current-user-privilege-set>
				<a:calendar-color>#3B82F6FF</a:calendar-color>
				<d:resourcetype><d:collection /><c:calendar /></d:resourcetype>
				<c:supported-calendar-component-set>
					<c:comp name="VEVENT" />
				</c:supported-calendar-component-set>
			</d:prop>
		</d:propstat>
	</d:response>
	<d:response>
		<d:href>/calendars/owner%40example.com/todos-1/</d:href>`,
);

export const recurringReportResponse = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:response>
		<d:href>/calendars/owner%40example.com/events-1/weekly.ics</d:href>
		<d:propstat>
			<d:prop>
				<c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:weekly-planning
DTSTART:20260727T100000Z
DTEND:20260727T110000Z
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Weekly planning
ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:guest@example.com
END:VEVENT
END:VCALENDAR</c:calendar-data>
			</d:prop>
		</d:propstat>
	</d:response>
</d:multistatus>`;

export const recurringCalendarResource = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:weekly-planning\r
DTSTART:20260727T100000Z\r
DTEND:20260727T110000Z\r
RRULE:FREQ=WEEKLY;COUNT=2\r
SUMMARY:Weekly planning\r
ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:guest@example.com\r
END:VEVENT\r
END:VCALENDAR\r
`;
