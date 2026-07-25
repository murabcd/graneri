import type {
	CalendarEventDetailsInput,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import {
	parseIcsDateValue,
	parseIcsEvents,
	parseYandexCalendarData,
	unfoldIcsLines,
} from "./yandexCalendarIcs";
import {
	buildYandexCalendarEventIcs,
	escapeIcsText,
	foldIcsLine,
	formatCalDavTimestamp,
	formatIcsDate,
	formatIcsDateTime,
} from "./yandexCalendarIcsWriter";
import type {
	ParsedIcsEvent,
	YandexCalendarCollection,
	YandexCalendarConnection,
} from "./yandexCalendarTypes";

const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const CALDAV_NAMESPACE = "urn:ietf:params:xml:ns:caldav";
const WEBDAV_NAMESPACE = "DAV:";

export const YANDEX_CALENDAR_SERVER_ADDRESS = "caldav.yandex.ru";

const encodeXmlText = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

const decodeXmlText = (value: string) =>
	value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");

const escapeRegExp = (value: string) =>
	value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const getXmlTagContent = (xml: string, tagName: string) => {
	const expression = new RegExp(
		`<(?:[\\w-]+:)?${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escapeRegExp(tagName)}>`,
		"iu",
	);

	return expression.exec(xml)?.[1] ?? null;
};

const getXmlHrefValue = (xml: string) =>
	decodeXmlText(getXmlTagContent(xml, "href") ?? "").trim();

const getXmlResponseBlocks = (xml: string) =>
	xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/giu) ?? [];

const supportsCalendarEvents = (xml: string) => {
	const supportedComponents =
		getXmlTagContent(xml, "supported-calendar-component-set") ?? "";

	return /<(?:[\w-]+:)?comp\b[^>]*\bname\s*=\s*["']VEVENT["']/iu.test(
		supportedComponents,
	);
};

const normalizeHrefPath = (href: string) => {
	try {
		return new URL(href).pathname;
	} catch {
		return href;
	}
};

const buildYandexCalendarUrl = (serverAddress: string, path: string) =>
	new URL(path, `https://${serverAddress}`);

const buildBasicAuthHeader = (email: string, password: string) =>
	`Basic ${Buffer.from(`${email}:${password}`, "utf8").toString("base64")}`;

const fetchYandexDav = async ({
	body,
	connection,
	contentType = XML_CONTENT_TYPE,
	depth,
	headers,
	method,
	path,
	request = fetch,
}: {
	body?: string;
	connection: YandexCalendarConnection;
	contentType?: string;
	depth?: "0" | "1";
	headers?: Record<string, string>;
	method: "DELETE" | "GET" | "MKCALENDAR" | "PROPFIND" | "PUT" | "REPORT";
	path: string;
	request?: typeof fetch;
}) => {
	return await request(buildYandexCalendarUrl(connection.serverAddress, path), {
		method,
		headers: {
			Authorization: buildBasicAuthHeader(
				connection.email,
				connection.password,
			),
			...(method === "PROPFIND" || method === "REPORT"
				? { Depth: depth ?? "0" }
				: {}),
			"Content-Type": contentType,
			...headers,
		},
		body,
	});
};

const requireSuccessfulDavResponse = async (
	response: Response,
	errorContext: string,
) => {
	if (response.ok || response.status === 207) {
		return await response.text();
	}

	const responseText = await response.text().catch(() => "");
	const suffix = responseText.trim() ? ` ${responseText.trim()}` : "";
	throw new Error(`${errorContext} (${response.status}).${suffix}`.trim());
};

export const normalizeYandexCalendarEmail = (value: string) =>
	value.trim().toLowerCase();

export const getYandexCalendarPrincipalPath = (email: string) =>
	`/principals/users/${normalizeYandexCalendarEmail(email)}/`;

export const getYandexCalendarHomePath = (email: string) =>
	`/calendars/${normalizeYandexCalendarEmail(email)}/`;

const resolveCalendarHomePathFromPrincipal = async ({
	email,
	password,
	serverAddress,
}: {
	email: string;
	password: string;
	serverAddress: string;
}) => {
	const principalPath = getYandexCalendarPrincipalPath(email);
	const response = await fetchYandexDav({
		connection: {
			email,
			password,
			serverAddress,
			calendarHomePath: principalPath,
		},
		method: "PROPFIND",
		path: principalPath,
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}">
	<d:prop>
		<c:calendar-home-set />
	</d:prop>
</d:propfind>`,
	});
	const xml = await requireSuccessfulDavResponse(
		response,
		"Failed to connect Yandex Calendar",
	);
	const calendarHomeSetXml = getXmlTagContent(xml, "calendar-home-set") ?? "";
	const calendarHomeHref = getXmlHrefValue(calendarHomeSetXml);

	if (calendarHomeHref) {
		return normalizeHrefPath(calendarHomeHref);
	}

	return getYandexCalendarHomePath(email);
};

export const verifyYandexCalendarConnection = async ({
	email,
	password,
	serverAddress = YANDEX_CALENDAR_SERVER_ADDRESS,
}: {
	email: string;
	password: string;
	serverAddress?: string;
}) => {
	const normalizedEmail = normalizeYandexCalendarEmail(email);
	const calendarHomePath = await resolveCalendarHomePathFromPrincipal({
		email: normalizedEmail,
		password,
		serverAddress,
	});

	return {
		email: normalizedEmail,
		serverAddress,
		calendarHomePath,
	};
};

const parseYandexCalendarCollections = (
	xml: string,
	connection: YandexCalendarConnection,
) => {
	const normalizedHomePath = normalizeHrefPath(connection.calendarHomePath);

	return getXmlResponseBlocks(xml)
		.map((block) => {
			const href = decodeXmlText(getXmlTagContent(block, "href") ?? "").trim();
			const responsePath = normalizeHrefPath(href);
			const resourceType = getXmlTagContent(block, "resourcetype") ?? "";

			if (
				!href ||
				responsePath === normalizedHomePath ||
				!/<(?:[\w-]+:)?calendar\b/iu.test(resourceType) ||
				!supportsCalendarEvents(block)
			) {
				return null;
			}

			const color = decodeXmlText(
				getXmlTagContent(block, "calendar-color") ?? "",
			)
				.trim()
				.slice(0, 7);

			if (!/^#[0-9a-f]{6}$/iu.test(color)) {
				throw new Error(
					`Yandex calendar "${responsePath}" did not expose a valid color.`,
				);
			}

			return {
				color,
				id: `yandex:${responsePath}`,
				displayName:
					decodeXmlText(getXmlTagContent(block, "displayname") ?? "").trim() ||
					"Yandex Calendar",
				href: responsePath,
			} satisfies YandexCalendarCollection;
		})
		.filter(
			(calendar): calendar is YandexCalendarCollection => calendar !== null,
		);
};

const listYandexCalendarCollections = async ({
	connection,
	request,
}: {
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const response = await fetchYandexDav({
		connection,
		method: "PROPFIND",
		path: connection.calendarHomePath,
		depth: "1",
		request,
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}" xmlns:a="http://apple.com/ns/ical/">
	<d:prop>
		<d:displayname />
		<d:resourcetype />
		<c:supported-calendar-component-set />
		<a:calendar-color />
	</d:prop>
</d:propfind>`,
	});
	const xml = await requireSuccessfulDavResponse(
		response,
		"Failed to load Yandex calendars",
	);

	return parseYandexCalendarCollections(xml, connection);
};

const parseYandexCalendarReport = ({
	calendar,
	now,
	timeMax,
	timeMin,
	xml,
}: {
	calendar: YandexCalendarCollection;
	now: number;
	timeMax: number;
	timeMin: number;
	xml: string;
}) =>
	getXmlResponseBlocks(xml).flatMap((block) => {
		const href = decodeXmlText(getXmlTagContent(block, "href") ?? "").trim();
		const calendarData = decodeXmlText(
			getXmlTagContent(block, "calendar-data") ?? "",
		).trim();

		if (!href || !calendarData) {
			return [];
		}

		return parseYandexCalendarData({
			calendar,
			calendarData,
			href,
			minimumEndAt: now,
			timeMax,
			timeMin,
		});
	});

export const listYandexUpcomingEvents = async ({
	connection,
	now,
	request,
	timeMax,
	timeMin,
}: {
	connection: YandexCalendarConnection;
	now: number;
	request?: typeof fetch;
	timeMax: number;
	timeMin: number;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});

	if (calendars.length === 0) {
		return {
			calendars: [],
			connectedCalendarCount: 0,
			events: [],
		};
	}

	const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}">
	<d:prop>
		<d:getetag />
		<c:calendar-data>
			<c:expand start="${encodeXmlText(formatCalDavTimestamp(timeMin))}" end="${encodeXmlText(formatCalDavTimestamp(timeMax))}" />
		</c:calendar-data>
	</d:prop>
	<c:filter>
		<c:comp-filter name="VCALENDAR">
			<c:comp-filter name="VEVENT">
				<c:time-range start="${encodeXmlText(formatCalDavTimestamp(timeMin))}" end="${encodeXmlText(formatCalDavTimestamp(timeMax))}" />
			</c:comp-filter>
		</c:comp-filter>
	</c:filter>
</c:calendar-query>`;

	const eventGroups = await Promise.all(
		calendars.map(async (calendar) => {
			const response = await fetchYandexDav({
				connection,
				method: "REPORT",
				path: calendar.href,
				depth: "1",
				request,
				body: reportBody,
			});
			const xml = await requireSuccessfulDavResponse(
				response,
				`Failed to load ${calendar.displayName}`,
			);

			return parseYandexCalendarReport({
				calendar,
				now,
				timeMax,
				timeMin,
				xml,
			});
		}),
	);

	return {
		calendars: calendars.map((calendar) => ({
			canCreateEvents: true,
			color: calendar.color,
			id: calendar.id,
			name: calendar.displayName,
			provider: "yandex" as const,
		})),
		connectedCalendarCount: calendars.length,
		events: eventGroups.flat(),
	};
};

export const createYandexCalendar = async ({
	color,
	connection,
	name,
	request,
	uid = crypto.randomUUID(),
}: {
	color: string;
	connection: YandexCalendarConnection;
	name: string;
	request?: typeof fetch;
	uid?: string;
}) => {
	const calendarPath = `${connection.calendarHomePath.replace(/\/?$/u, "/")}graneri-${encodeURIComponent(uid)}/`;
	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}" xmlns:a="http://apple.com/ns/ical/">
	<d:set>
		<d:prop>
			<d:displayname>${encodeXmlText(name)}</d:displayname>
			<c:supported-calendar-component-set>
				<c:comp name="VEVENT" />
			</c:supported-calendar-component-set>
			<a:calendar-color>${encodeXmlText(color.toUpperCase())}FF</a:calendar-color>
		</d:prop>
	</d:set>
</c:mkcalendar>`,
		connection,
		method: "MKCALENDAR",
		path: calendarPath,
		request,
	});
	await requireSuccessfulDavResponse(
		response,
		"Failed to create Yandex calendar",
	);

	return { id: `yandex:${calendarPath}` };
};

const getIcsLinePropertyName = (line: string) =>
	line.slice(0, line.search(/[:;]/u)).toUpperCase();

const getIcsEventBlockRanges = (lines: string[]) => {
	const ranges: Array<{ end: number; start: number }> = [];
	let start = -1;

	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index] === "BEGIN:VEVENT") {
			start = index;
			continue;
		}

		if (lines[index] === "END:VEVENT" && start >= 0) {
			ranges.push({ start, end: index });
			start = -1;
		}
	}

	return ranges;
};

const parseIcsEventBlock = (lines: string[]) =>
	parseIcsEvents(lines.join("\r\n"))[0] ?? null;

const getRecurrenceIdIso = (event: ParsedIcsEvent) => {
	const recurrenceId = event["RECURRENCE-ID"];

	if (!recurrenceId) {
		return undefined;
	}

	return (
		parseIcsDateValue(
			recurrenceId.value,
			recurrenceId.parameters,
			false,
		)?.toISOString() ?? undefined
	);
};

const getPreservedEventLines = ({
	eventLines,
	isOverride,
}: {
	eventLines: string[];
	isOverride: boolean;
}) => {
	const excludedProperties = new Set([
		"DESCRIPTION",
		"DTEND",
		"DTSTAMP",
		"DTSTART",
		"DURATION",
		"LAST-MODIFIED",
		"LOCATION",
		"SEQUENCE",
		"SUMMARY",
		"UID",
		...(isOverride
			? ["CREATED", "EXDATE", "RDATE", "RECURRENCE-ID", "RRULE", "STATUS"]
			: []),
	]);
	const preservedLines: string[] = [];
	let nestedComponentDepth = 0;

	for (const line of eventLines.slice(1, -1)) {
		if (line.startsWith("BEGIN:")) {
			nestedComponentDepth += 1;
			preservedLines.push(line);
			continue;
		}

		if (nestedComponentDepth > 0) {
			preservedLines.push(line);
			if (line.startsWith("END:")) {
				nestedComponentDepth -= 1;
			}
			continue;
		}

		if (!excludedProperties.has(getIcsLinePropertyName(line))) {
			preservedLines.push(line);
		}
	}

	return preservedLines;
};

const getNextSequence = (event: ParsedIcsEvent) => {
	const sequence = Number(event.SEQUENCE?.value ?? "0");
	return Number.isFinite(sequence) ? Math.max(0, sequence) + 1 : 1;
};

const buildYandexEventTimeLines = (time: UpdateCalendarEventInput["time"]) =>
	time.kind === "all_day"
		? [
				`DTSTART;VALUE=DATE:${formatIcsDate(time.startDate)}`,
				`DTEND;VALUE=DATE:${formatIcsDate(time.endDate)}`,
			]
		: [
				`DTSTART:${formatIcsDateTime(time.startAt)}`,
				`DTEND:${formatIcsDateTime(time.endAt)}`,
			];

const formatYandexRecurrenceId = ({
	isAllDay,
	recurrenceId,
}: {
	isAllDay: boolean;
	recurrenceId: string;
}) =>
	isAllDay
		? `RECURRENCE-ID;VALUE=DATE:${formatIcsDate(
				new Date(recurrenceId).toISOString().slice(0, 10),
			)}`
		: `RECURRENCE-ID:${formatIcsDateTime(recurrenceId)}`;

const buildUpdatedYandexEventLines = ({
	baseEventLines,
	input,
	now,
}: {
	baseEventLines: string[];
	input: UpdateCalendarEventInput;
	now: number;
}) => {
	const baseEvent = parseIcsEventBlock(baseEventLines);
	const uid = baseEvent?.UID?.value;

	if (!baseEvent || !uid) {
		throw new Error("The Yandex event resource is invalid.");
	}

	const isOverride = Boolean(input.recurrenceId);
	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(baseEvent)}`,
		...(input.recurrenceId
			? [
					formatYandexRecurrenceId({
						isAllDay: input.recurrenceIsAllDay ?? false,
						recurrenceId: input.recurrenceId,
					}),
				]
			: []),
		...buildYandexEventTimeLines(input.time),
		`SUMMARY:${escapeIcsText(input.title)}`,
		...(input.description
			? [`DESCRIPTION:${escapeIcsText(input.description)}`]
			: []),
		...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
		...getPreservedEventLines({
			eventLines: baseEventLines,
			isOverride,
		}),
		"END:VEVENT",
	];
};

const buildCancelledYandexEventLines = ({
	baseEventLines,
	now,
	recurrenceId,
	recurrenceIsAllDay,
}: {
	baseEventLines: string[];
	now: number;
	recurrenceId: string;
	recurrenceIsAllDay: boolean;
}) => {
	const baseEvent = parseIcsEventBlock(baseEventLines);
	const uid = baseEvent?.UID?.value;

	if (!baseEvent || !uid) {
		throw new Error("The Yandex event resource is invalid.");
	}

	return [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatCalDavTimestamp(now)}`,
		`SEQUENCE:${getNextSequence(baseEvent)}`,
		formatYandexRecurrenceId({
			isAllDay: recurrenceIsAllDay,
			recurrenceId,
		}),
		"STATUS:CANCELLED",
		"END:VEVENT",
	];
};

const updateYandexCalendarResource = ({
	calendarData,
	input,
	now,
}: {
	calendarData: string;
	input: UpdateCalendarEventInput;
	now: number;
}) => {
	const lines = unfoldIcsLines(calendarData)
		.split("\n")
		.map((line) => line.trimEnd());
	const ranges = getIcsEventBlockRanges(lines);
	const baseRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && !event["RECURRENCE-ID"];
	});

	if (!baseRange) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	const baseEventLines = lines.slice(baseRange.start, baseRange.end + 1);
	const updatedEventLines = buildUpdatedYandexEventLines({
		baseEventLines,
		input,
		now,
	});
	const targetRange = input.recurrenceId
		? ranges.find(({ end, start }) => {
				const event = parseIcsEventBlock(lines.slice(start, end + 1));
				return event && getRecurrenceIdIso(event) === input.recurrenceId;
			})
		: baseRange;

	if (targetRange) {
		lines.splice(
			targetRange.start,
			targetRange.end - targetRange.start + 1,
			...updatedEventLines,
		);
	} else {
		const calendarEnd = lines.lastIndexOf("END:VCALENDAR");

		if (calendarEnd < 0) {
			throw new Error("The Yandex event resource has no calendar boundary.");
		}

		lines.splice(calendarEnd, 0, ...updatedEventLines);
	}

	return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
};

const cancelYandexCalendarOccurrence = ({
	calendarData,
	now,
	recurrenceId,
	recurrenceIsAllDay,
}: {
	calendarData: string;
	now: number;
	recurrenceId: string;
	recurrenceIsAllDay: boolean;
}) => {
	const lines = unfoldIcsLines(calendarData)
		.split("\n")
		.map((line) => line.trimEnd());
	const ranges = getIcsEventBlockRanges(lines);
	const baseRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && !event["RECURRENCE-ID"];
	});

	if (!baseRange) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	const cancelledEventLines = buildCancelledYandexEventLines({
		baseEventLines: lines.slice(baseRange.start, baseRange.end + 1),
		now,
		recurrenceId,
		recurrenceIsAllDay,
	});
	const targetRange = ranges.find(({ end, start }) => {
		const event = parseIcsEventBlock(lines.slice(start, end + 1));
		return event && getRecurrenceIdIso(event) === recurrenceId;
	});

	if (targetRange) {
		lines.splice(
			targetRange.start,
			targetRange.end - targetRange.start + 1,
			...cancelledEventLines,
		);
	} else {
		const calendarEnd = lines.lastIndexOf("END:VCALENDAR");

		if (calendarEnd < 0) {
			throw new Error("The Yandex event resource has no calendar boundary.");
		}

		lines.splice(calendarEnd, 0, ...cancelledEventLines);
	}

	return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
};

const getYandexCalendarEventTarget = async ({
	calendarId,
	connection,
	providerEventId,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	providerEventId: string;
	request?: typeof fetch;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});
	const calendar = calendars.find((candidate) => candidate.id === calendarId);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}

	const calendarPath = `${normalizeHrefPath(calendar.href).replace(/\/?$/u, "/")}`;
	const eventPath = normalizeHrefPath(providerEventId);

	if (!eventPath.startsWith(calendarPath) || eventPath === calendarPath) {
		throw new Error("The selected Yandex event is not in this calendar.");
	}

	return eventPath;
};

const loadYandexCalendarEventResource = async ({
	connection,
	path,
	request,
}: {
	connection: YandexCalendarConnection;
	path: string;
	request?: typeof fetch;
}) => {
	const response = await fetchYandexDav({
		connection,
		method: "GET",
		path,
		request,
	});
	const calendarData = await requireSuccessfulDavResponse(
		response,
		"Failed to load Yandex event",
	);

	return {
		calendarData,
		etag: response.headers.get("etag") ?? undefined,
	};
};

export const updateYandexCalendarEvent = async ({
	connection,
	input,
	now = Date.now(),
	request,
}: {
	connection: YandexCalendarConnection;
	input: UpdateCalendarEventInput;
	now?: number;
	request?: typeof fetch;
}) => {
	const path = await getYandexCalendarEventTarget({
		calendarId: input.calendarId,
		connection,
		providerEventId: input.providerEventId,
		request,
	});
	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	const response = await fetchYandexDav({
		body: updateYandexCalendarResource({ calendarData, input, now }),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: etag ? { "If-Match": etag } : undefined,
		method: "PUT",
		path,
		request,
	});

	await requireSuccessfulDavResponse(response, "Failed to update Yandex event");
	return null;
};

export const deleteYandexCalendarEvent = async ({
	calendarId,
	connection,
	providerEventId,
	recurrenceId,
	recurrenceIsAllDay = false,
	now = Date.now(),
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	providerEventId: string;
	recurrenceId?: string;
	recurrenceIsAllDay?: boolean;
	now?: number;
	request?: typeof fetch;
}) => {
	const path = await getYandexCalendarEventTarget({
		calendarId,
		connection,
		providerEventId,
		request,
	});

	if (!recurrenceId) {
		const response = await fetchYandexDav({
			connection,
			method: "DELETE",
			path,
			request,
		});
		await requireSuccessfulDavResponse(
			response,
			"Failed to delete Yandex event",
		);
		return null;
	}

	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	const response = await fetchYandexDav({
		body: cancelYandexCalendarOccurrence({
			calendarData,
			now,
			recurrenceId,
			recurrenceIsAllDay,
		}),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: etag ? { "If-Match": etag } : undefined,
		method: "PUT",
		path,
		request,
	});
	await requireSuccessfulDavResponse(
		response,
		"Failed to delete Yandex event occurrence",
	);
	return null;
};

export const createYandexCalendarEvent = async ({
	connection,
	input,
	now = Date.now(),
	request,
	uid = crypto.randomUUID(),
}: {
	connection: YandexCalendarConnection;
	input: CalendarEventDetailsInput;
	now?: number;
	request?: typeof fetch;
	uid?: string;
}) => {
	const calendars = await listYandexCalendarCollections({
		connection,
		request,
	});
	const calendar = calendars.find(
		(candidate) => candidate.id === input.calendarId,
	);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}

	const eventPath = `${calendar.href.replace(/\/?$/u, "/")}${encodeURIComponent(uid)}.ics`;
	const response = await fetchYandexDav({
		body: buildYandexCalendarEventIcs({ input, now, uid }),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-None-Match": "*" },
		method: "PUT",
		path: eventPath,
		request,
	});

	if (!response.ok) {
		await requireSuccessfulDavResponse(
			response,
			"Failed to create Yandex event",
		);
	}

	return { id: `yandex:${uid}` };
};
