import { ConvexError } from "convex/values";
import type {
	CalendarEventDetailsInput,
	UpdateCalendarEventInput,
} from "./calendarTypes";
import { requireCalendarEventEtag } from "./calendarProviderConcurrency";
import {
	parseIcsEvents,
	parseYandexCalendarData,
} from "./yandexCalendarIcs";
import {
	cancelYandexCalendarOccurrence,
	normalizeYandexAttendeeEmail,
	updateYandexCalendarResource,
} from "./yandexCalendarEventMutation";
import {
	buildYandexCalendarEventIcs,
	formatCalDavTimestamp,
} from "./yandexCalendarIcsWriter";
import type {
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

const hasCalendarWritePrivilege = (xml: string) => {
	const privileges = getXmlTagContent(xml, "current-user-privilege-set") ?? "";

	return /<(?:[\w-]+:)?(?:all|write|write-content)(?:\s|\/|>)/iu.test(
		privileges,
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
				canWrite: hasCalendarWritePrivilege(block),
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
		<d:current-user-privilege-set />
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
	selfEmail,
	timeMax,
	timeMin,
	xml,
}: {
	calendar: YandexCalendarCollection;
	now: number;
	selfEmail: string;
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
			selfEmail,
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
				selfEmail: connection.email,
				timeMax,
				timeMin,
				xml,
			});
		}),
	);

	return {
		calendars: calendars.map((calendar) => ({
			canCreateEvents: calendar.canWrite,
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

	if (!calendar.canWrite) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow event changes.",
		});
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

const assertYandexCalendarEventCanBeManaged = ({
	calendarData,
	connection,
	operation,
}: {
	calendarData: string;
	connection: YandexCalendarConnection;
	operation: "delete" | "edit";
}) => {
	const baseEvent = parseIcsEvents(calendarData).find(
		(event) => !event.properties["RECURRENCE-ID"],
	);
	const organizer = baseEvent?.properties.ORGANIZER;

	if (!baseEvent) {
		throw new Error("The Yandex event resource has no editable event.");
	}

	if (
		organizer &&
		normalizeYandexAttendeeEmail(organizer.value) !==
			normalizeYandexCalendarEmail(connection.email)
	) {
		throw new ConvexError({
			code:
				operation === "edit"
					? "CALENDAR_EVENT_EDIT_FORBIDDEN"
					: "CALENDAR_EVENT_DELETE_FORBIDDEN",
			message: `Only the organizer can ${operation} this event.`,
		});
	}
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
	assertYandexCalendarEventCanBeManaged({
		calendarData,
		connection,
		operation: "edit",
	});
	const concurrencyEtag = requireCalendarEventEtag(etag);
	const response = await fetchYandexDav({
		body: updateYandexCalendarResource({ calendarData, input, now }),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-Match": concurrencyEtag },
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

	const { calendarData, etag } = await loadYandexCalendarEventResource({
		connection,
		path,
		request,
	});
	assertYandexCalendarEventCanBeManaged({
		calendarData,
		connection,
		operation: "delete",
	});
	const concurrencyEtag = requireCalendarEventEtag(etag);

	if (!recurrenceId) {
		const response = await fetchYandexDav({
			connection,
			headers: { "If-Match": concurrencyEtag },
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

	const response = await fetchYandexDav({
		body: cancelYandexCalendarOccurrence({
			calendarData,
			now,
			recurrenceId,
			recurrenceIsAllDay,
		}),
		connection,
		contentType: "text/calendar; charset=utf-8",
		headers: { "If-Match": concurrencyEtag },
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
		(candidate) => candidate.id === input.calendarId && candidate.canWrite,
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
