import { consumeDesktopTrayCalendarEvent } from "@workspace/platform/desktop";
import * as React from "react";
import type { UpcomingCalendarEvent } from "@/app/app-types";

const MAX_CACHED_CALENDAR_EVENT_REQUESTS = 32;
const requests = new Map<string, Promise<UpcomingCalendarEvent | null>>();

export const getDesktopCalendarEventRequest = (requestId: string) => {
	const existing = requests.get(requestId);
	if (existing) {
		return existing;
	}

	const request = consumeDesktopTrayCalendarEvent(requestId);
	requests.set(requestId, request);
	while (requests.size > MAX_CACHED_CALENDAR_EVENT_REQUESTS) {
		const oldestRequestId = requests.keys().next().value;
		if (!oldestRequestId) {
			break;
		}
		requests.delete(oldestRequestId);
	}
	return request;
};

export const releaseDesktopCalendarEventRequest = (requestId: string) => {
	requests.delete(requestId);
};

export const useDesktopCalendarEventRequest = ({
	onUnavailable,
	requestId,
}: {
	onUnavailable: (error?: unknown) => void;
	requestId: string | null;
}) => {
	const [resolvedRequest, setResolvedRequest] = React.useState<{
		event: UpcomingCalendarEvent;
		requestId: string;
	} | null>(null);

	React.useEffect(() => {
		if (!requestId) {
			setResolvedRequest(null);
			return;
		}

		let isActive = true;
		setResolvedRequest(null);
		void getDesktopCalendarEventRequest(requestId)
			.then((event) => {
				if (!isActive) {
					releaseDesktopCalendarEventRequest(requestId);
					return;
				}
				if (!event) {
					releaseDesktopCalendarEventRequest(requestId);
					onUnavailable();
					return;
				}
				setResolvedRequest({ event, requestId });
			})
			.catch((error) => {
				if (!isActive) {
					releaseDesktopCalendarEventRequest(requestId);
					return;
				}
				releaseDesktopCalendarEventRequest(requestId);
				onUnavailable(error);
			});

		return () => {
			isActive = false;
		};
	}, [onUnavailable, requestId]);

	const event =
		requestId && resolvedRequest?.requestId === requestId
			? resolvedRequest.event
			: null;
	const release = React.useCallback(() => {
		if (requestId) {
			releaseDesktopCalendarEventRequest(requestId);
		}
	}, [requestId]);

	return React.useMemo(
		() => ({
			event,
			isResolving: requestId !== null && event === null,
			release,
		}),
		[event, release, requestId],
	);
};
