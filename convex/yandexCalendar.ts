import { ConvexError } from "convex/values";
import { parseYandexCalendarData } from "./yandexCalendarIcs";
import { formatCalDavTimestamp } from "./yandexCalendarIcsWriter";
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

const hasCalendarPropertyWritePrivilege = (xml: string) => {
	const privileges = getXmlTagContent(xml, "current-user-privilege-set") ?? "";

	return /<(?:[\w-]+:)?(?:all|write|write-properties)(?:\s|\/|>)/iu.test(
		privileges,
	);
};

export const normalizeHrefPath = (href: string) => {
	try {
		return new URL(href).pathname;
	} catch {
		return href;
	}
};

const normalizeComparableHrefPath = (href: string) =>
	normalizeHrefPath(href)
		.split("/")
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		})
		.join("/")
		.replace(/\/+$/u, "");

export const buildYandexCalendarUrl = (serverAddress: string, path: string) =>
	new URL(path, `https://${serverAddress}`);

const buildBasicAuthHeader = (email: string, password: string) =>
	`Basic ${Buffer.from(`${email}:${password}`, "utf8").toString("base64")}`;

export const fetchYandexDav = async ({
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
	method:
		| "DELETE"
		| "GET"
		| "MKCALENDAR"
		| "MOVE"
		| "PROPFIND"
		| "PROPPATCH"
		| "PUT"
		| "REPORT";
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
			...((method === "PROPFIND" || method === "REPORT") && {
				Depth: depth ?? "0",
			}),
			"Content-Type": contentType,
			...headers,
		},
		body,
	});
};

export const requireSuccessfulDavResponse = async (
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

const requireSuccessfulDavPropertyUpdate = async (
	response: Response,
	errorContext: string,
) => {
	const xml = await requireSuccessfulDavResponse(response, errorContext);
	const statusCodes = Array.from(
		xml.matchAll(/<(?:[\w-]+:)?status\b[^>]*>[^<]*\s(\d{3})(?:\s|<)/giu),
	).map((match) => Number(match[1]));
	const failedStatus = statusCodes.find(
		(status) => status < 200 || status >= 300,
	);

	if (failedStatus !== undefined) {
		throw new Error(`${errorContext} (${failedStatus}).`);
	}

	return xml;
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

const resolveYandexSchedulingInboxPath = async ({
	connection,
	request,
}: {
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const principalPath = getYandexCalendarPrincipalPath(connection.email);
	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}">
	<d:prop><c:schedule-inbox-URL /></d:prop>
</d:propfind>`,
		connection,
		depth: "0",
		method: "PROPFIND",
		path: principalPath,
		request,
	});
	const xml = await requireSuccessfulDavResponse(
		response,
		"Failed to load Yandex scheduling settings",
	);
	const scheduleInboxXml = getXmlTagContent(xml, "schedule-inbox-URL") ?? "";
	const scheduleInboxPath = getXmlHrefValue(scheduleInboxXml);

	if (!scheduleInboxPath) {
		throw new Error("Yandex Calendar did not expose a scheduling inbox.");
	}

	return normalizeHrefPath(scheduleInboxPath);
};

const loadYandexDefaultCalendarState = async ({
	connection,
	request,
}: {
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const scheduleInboxPath = await resolveYandexSchedulingInboxPath({
		connection,
		request,
	});
	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}">
	<d:prop><c:schedule-default-calendar-URL /></d:prop>
</d:propfind>`,
		connection,
		depth: "0",
		method: "PROPFIND",
		path: scheduleInboxPath,
		request,
	});
	const xml = await requireSuccessfulDavResponse(
		response,
		"Failed to load the default Yandex calendar",
	);
	const defaultCalendarXml =
		getXmlTagContent(xml, "schedule-default-calendar-URL") ?? "";
	const defaultCalendarPath = getXmlHrefValue(defaultCalendarXml);

	if (!defaultCalendarPath) {
		throw new Error("Yandex Calendar did not expose a default calendar.");
	}

	return {
		defaultCalendarPath: normalizeHrefPath(defaultCalendarPath),
		scheduleInboxPath,
	};
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
	const normalizedHomePath = normalizeComparableHrefPath(
		connection.calendarHomePath,
	);
	const responseBlocks = getXmlResponseBlocks(xml);

	return responseBlocks
		.map((block) => {
			const href = decodeXmlText(getXmlTagContent(block, "href") ?? "").trim();
			const responsePath = normalizeHrefPath(href);
			const resourceType = getXmlTagContent(block, "resourcetype") ?? "";

			if (
				!href ||
				normalizeComparableHrefPath(responsePath) === normalizedHomePath ||
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
				canEdit: hasCalendarPropertyWritePrivilege(block),
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

export const listYandexCalendarCollections = async ({
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
	const [calendars, defaultCalendarState] = await Promise.all([
		listYandexCalendarCollections({
			connection,
			request,
		}),
		loadYandexDefaultCalendarState({ connection, request }),
	]);

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
		calendars: calendars.map((calendar) => {
			const isDefault =
				normalizeComparableHrefPath(calendar.href) ===
				normalizeComparableHrefPath(defaultCalendarState.defaultCalendarPath);
			const canDelete = calendar.canEdit && calendar.canWrite && !isDefault;

			return {
				canCreateEvents: calendar.canWrite,
				canEdit: calendar.canEdit,
				canSetDefault: canDelete,
				color: calendar.color,
				id: calendar.id,
				name: calendar.displayName,
				provider: "yandex" as const,
				removalMode: canDelete ? ("delete" as const) : ("none" as const),
				requiresEventMove: canDelete,
			};
		}),
		connectedCalendarCount: calendars.length,
		events: eventGroups.flat(),
	};
};

export const setDefaultYandexCalendar = async ({
	calendarId,
	connection,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const [calendars, defaultCalendarState] = await Promise.all([
		listYandexCalendarCollections({ connection, request }),
		loadYandexDefaultCalendarState({ connection, request }),
	]);
	const calendar = calendars.find((candidate) => candidate.id === calendarId);

	if (!calendar) {
		throw new Error("The selected Yandex calendar is not available.");
	}
	if (!calendar.canEdit || !calendar.canWrite) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar cannot be set as default.",
		});
	}
	if (
		normalizeComparableHrefPath(calendar.href) ===
		normalizeComparableHrefPath(defaultCalendarState.defaultCalendarPath)
	) {
		return null;
	}

	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="${WEBDAV_NAMESPACE}" xmlns:c="${CALDAV_NAMESPACE}">
	<d:set>
		<d:prop>
			<c:schedule-default-calendar-URL>
				<d:href>${encodeXmlText(calendar.href)}</d:href>
			</c:schedule-default-calendar-URL>
		</d:prop>
	</d:set>
</d:propertyupdate>`,
		connection,
		method: "PROPPATCH",
		path: defaultCalendarState.scheduleInboxPath,
		request,
	});
	await requireSuccessfulDavPropertyUpdate(
		response,
		"Failed to set the default Yandex calendar",
	);
	const verifiedState = await loadYandexDefaultCalendarState({
		connection,
		request,
	});
	if (
		normalizeComparableHrefPath(verifiedState.defaultCalendarPath) !==
		normalizeComparableHrefPath(calendar.href)
	) {
		throw new Error("Yandex Calendar did not apply the default calendar.");
	}

	return null;
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

const requireYandexCalendarCollection = async ({
	calendarId,
	connection,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
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
	return calendar;
};

export const updateYandexCalendar = async ({
	calendarId,
	color,
	connection,
	name,
	request,
}: {
	calendarId: string;
	color: string;
	connection: YandexCalendarConnection;
	name: string;
	request?: typeof fetch;
}) => {
	const calendar = await requireYandexCalendarCollection({
		calendarId,
		connection,
		request,
	});

	if (!calendar.canEdit) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendar does not allow changes.",
		});
	}

	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="${WEBDAV_NAMESPACE}" xmlns:a="http://apple.com/ns/ical/">
	<d:set>
		<d:prop>
			<d:displayname>${encodeXmlText(name)}</d:displayname>
			<a:calendar-color>${encodeXmlText(color.toUpperCase())}FF</a:calendar-color>
		</d:prop>
	</d:set>
</d:propertyupdate>`,
		connection,
		method: "PROPPATCH",
		path: calendar.href,
		request,
	});
	await requireSuccessfulDavPropertyUpdate(
		response,
		"Failed to update Yandex calendar",
	);
	return null;
};

const listYandexCalendarResourcePaths = async ({
	calendar,
	connection,
	request,
}: {
	calendar: YandexCalendarCollection;
	connection: YandexCalendarConnection;
	request?: typeof fetch;
}) => {
	const response = await fetchYandexDav({
		body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${WEBDAV_NAMESPACE}">
	<d:prop><d:resourcetype /></d:prop>
</d:propfind>`,
		connection,
		depth: "1",
		method: "PROPFIND",
		path: calendar.href,
		request,
	});
	const xml = await requireSuccessfulDavResponse(
		response,
		"Failed to load Yandex calendar events",
	);
	const calendarPath = `${normalizeHrefPath(calendar.href).replace(/\/?$/u, "/")}`;

	return getXmlResponseBlocks(xml).flatMap((block) => {
		const href = normalizeHrefPath(getXmlHrefValue(block));
		const resourceType = getXmlTagContent(block, "resourcetype") ?? "";

		return href.startsWith(calendarPath) &&
			href !== calendarPath &&
			!/<(?:[\w-]+:)?collection(?:\s|\/|>)/iu.test(resourceType)
			? [href]
			: [];
	});
};

export const removeYandexCalendar = async ({
	calendarId,
	connection,
	destinationCalendarId,
	request,
}: {
	calendarId: string;
	connection: YandexCalendarConnection;
	destinationCalendarId?: string;
	request?: typeof fetch;
}) => {
	if (!destinationCalendarId || destinationCalendarId === calendarId) {
		throw new ConvexError({
			code: "CALENDAR_MOVE_DESTINATION_REQUIRED",
			message: "Choose another calendar for the existing events.",
		});
	}

	const [calendars, defaultCalendarState] = await Promise.all([
		listYandexCalendarCollections({ connection, request }),
		loadYandexDefaultCalendarState({ connection, request }),
	]);
	const calendar = calendars.find((candidate) => candidate.id === calendarId);
	const destinationCalendar = calendars.find(
		(candidate) => candidate.id === destinationCalendarId,
	);
	if (!calendar || !destinationCalendar) {
		throw new Error("The selected Yandex calendars are not available.");
	}
	if (
		!calendar.canEdit ||
		!calendar.canWrite ||
		!destinationCalendar.canWrite
	) {
		throw new ConvexError({
			code: "CALENDAR_NOT_WRITABLE",
			message: "The selected calendars do not allow event changes.",
		});
	}
	if (
		normalizeComparableHrefPath(calendar.href) ===
		normalizeComparableHrefPath(defaultCalendarState.defaultCalendarPath)
	) {
		throw new ConvexError({
			code: "PRIMARY_CALENDAR_CANNOT_BE_DELETED",
			message: "The default Yandex calendar cannot be deleted.",
		});
	}

	const [sourcePaths, destinationPaths] = await Promise.all([
		listYandexCalendarResourcePaths({ calendar, connection, request }),
		listYandexCalendarResourcePaths({
			calendar: destinationCalendar,
			connection,
			request,
		}),
	]);
	const destinationPath = `${normalizeHrefPath(destinationCalendar.href).replace(/\/?$/u, "/")}`;
	const destinationNames = new Set(
		destinationPaths.map((path) => path.split("/").filter(Boolean).at(-1)),
	);

	for (const sourcePath of sourcePaths) {
		const filename = sourcePath.split("/").filter(Boolean).at(-1);
		if (!filename || destinationNames.has(filename)) {
			throw new ConvexError({
				code: "CALENDAR_EVENT_MOVE_CONFLICT",
				message:
					"An event with the same provider identifier already exists in the destination calendar.",
			});
		}
	}

	for (const sourcePath of sourcePaths) {
		const filename = sourcePath.split("/").filter(Boolean).at(-1);
		if (!filename) {
			throw new Error("A Yandex calendar resource path is invalid.");
		}
		const moveResponse = await fetchYandexDav({
			connection,
			headers: {
				Destination: buildYandexCalendarUrl(
					connection.serverAddress,
					`${destinationPath}${filename}`,
				).toString(),
				Overwrite: "F",
			},
			method: "MOVE",
			path: sourcePath,
			request,
		});
		await requireSuccessfulDavResponse(
			moveResponse,
			"Failed to move a Yandex calendar event",
		);
	}

	const deleteResponse = await fetchYandexDav({
		connection,
		method: "DELETE",
		path: calendar.href,
		request,
	});
	await requireSuccessfulDavResponse(
		deleteResponse,
		"Failed to delete Yandex calendar",
	);
	return null;
};
