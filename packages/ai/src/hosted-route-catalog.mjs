const staticRoute = ({ id, method, path, proxyBodyMode }) =>
	Object.freeze({
		id,
		method,
		proxyBodyMode,
		buildPath: () => path,
		matches: (pathname) => pathname === path,
	});

const chatStreamRoute = Object.freeze({
	id: "chatStream",
	method: "GET",
	proxyBodyMode: "stream",
	buildPath: ({ chatId } = {}) => {
		if (typeof chatId !== "string" || chatId.length === 0) {
			throw new Error("chatStream route requires a chatId.");
		}
		return `/api/chat/${encodeURIComponent(chatId)}/stream`;
	},
	matches: (pathname) => /^\/api\/chat\/[^/]+\/stream$/.test(pathname),
});

const routeDefinitions = Object.freeze([
	staticRoute({
		id: "chat",
		method: "POST",
		path: "/api/chat",
		proxyBodyMode: "stream",
	}),
	staticRoute({
		id: "chatSteer",
		method: "POST",
		path: "/api/chat/steer",
		proxyBodyMode: "stream",
	}),
	staticRoute({
		id: "chatStop",
		method: "POST",
		path: "/api/chat/stop",
		proxyBodyMode: "stream",
	}),
	chatStreamRoute,
	staticRoute({
		id: "classifyMeetingEnd",
		method: "POST",
		path: "/api/classify-meeting-end",
		proxyBodyMode: "bufferedJson",
	}),
	staticRoute({
		id: "enhanceNote",
		method: "POST",
		path: "/api/enhance-note",
		proxyBodyMode: "bufferedJson",
	}),
	staticRoute({
		id: "generateProjectDescription",
		method: "POST",
		path: "/api/generate-project-description",
		proxyBodyMode: "bufferedJson",
	}),
	staticRoute({
		id: "applyTemplate",
		method: "POST",
		path: "/api/apply-template",
		proxyBodyMode: "stream",
	}),
	staticRoute({
		id: "realtimeTranscriptionSession",
		method: "POST",
		path: "/api/realtime-transcription-session",
		proxyBodyMode: "stream",
	}),
]);

const routesById = new Map(routeDefinitions.map((route) => [route.id, route]));

export const hostedRouteIds = Object.freeze(
	routeDefinitions.map((route) => route.id),
);

export const getHostedRouteDefinition = (routeId) => {
	const route = routesById.get(routeId);
	if (!route) {
		throw new Error(`Unknown hosted route: ${String(routeId)}.`);
	}
	return route;
};

export const matchHostedRoutePath = (pathname) =>
	routeDefinitions.find((route) => route.matches(pathname)) ?? null;

export const buildHostedRoutePath = (routeId) => {
	if (routeId === "chatStream") {
		throw new Error("Use buildHostedChatStreamPath for the chatStream route.");
	}
	return getHostedRouteDefinition(routeId).buildPath();
};

export const buildHostedChatStreamPath = (chatId) =>
	chatStreamRoute.buildPath({ chatId });
