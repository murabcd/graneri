import { createServer } from "node:http";
import { matchHostedRoutePath } from "@workspace/ai/hosted-route-catalog";
import { createAuthCallbackSuccessHtml } from "./local-server-auth-callback-page.mjs";
import { handleDictationTranscriptionRequest } from "./local-server-dictation-route.mjs";
import { proxyHostedAiRequest } from "./local-server-hosted-proxy.mjs";
import {
	isAuthorizedLocalAppRequest,
	sendJson,
	setCorsHeadersForLocalAppRequest,
} from "./local-server-http.mjs";
import { createLocalFolderToolRouteHandler } from "./local-server-local-folder-route.mjs";
import {
	createWideEvent,
	emitWideEvent,
	recordWideEventError,
} from "./logger.mjs";

const preferredLocalServerPorts = Array.from(
	{ length: 20 },
	(_value, index) => 42831 + index,
);

const handleHostedAiProxyRequest = async (request, response, route) => {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

	await proxyHostedAiRequest({
		path: requestUrl.pathname + requestUrl.search,
		request,
		response,
		responseMode: route.proxyBodyMode,
	});
};

const emitLocalRequestWideEventOnCompletion = ({
	event,
	response,
	startedAt,
}) => {
	let emitted = false;

	const emit = (level) => {
		if (emitted) {
			return;
		}

		emitted = true;
		event.status_code ??= response.statusCode;
		event.outcome ??=
			typeof event.status_code === "number" && event.status_code >= 400
				? "error"
				: "success";
		emitWideEvent({ event, level, startedAt });
	};

	response.once("finish", () => {
		emit(event.outcome === "error" || event.errors?.length ? "error" : "info");
	});
	response.once("close", () => {
		if (response.writableEnded) {
			return;
		}

		event.outcome = "error";
		event.error_code = "client_connection_closed";
		emit("error");
	});

	return emit;
};

export const startLocalServer = async ({
	getAllowedOrigins,
	getSharedLocalFolders,
	onAuthCallback,
} = {}) => {
	let localServerOrigin = null;
	const localAppRoutes = new Map([
		[
			"/api/local-folder-tool",
			createLocalFolderToolRouteHandler({
				getSharedLocalFolders,
			}),
		],
		["/api/dictation-transcription", handleDictationTranscriptionRequest],
	]);
	const server = createServer((request, response) => {
		const startedAt = Date.now();
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const requestPath = requestUrl.pathname;
		const hostedRoute = matchHostedRoutePath(requestPath);
		const isReconnectRoute = hostedRoute?.id === "chatStream";
		const localRouteHandler = localAppRoutes.get(requestPath) ?? null;
		const allowedOrigins = [
			localServerOrigin,
			...(typeof getAllowedOrigins === "function" ? getAllowedOrigins() : []),
		];

		if (requestPath === "/auth/callback") {
			const wideEvent = createWideEvent({
				event: "desktop.auth_callback.request",
				request,
			});
			wideEvent.route = "auth_callback";
			emitLocalRequestWideEventOnCompletion({
				event: wideEvent,
				response,
				startedAt,
			});
			void Promise.resolve(onAuthCallback?.(requestUrl.toString()))
				.then(() => {
					wideEvent.outcome = "success";
					wideEvent.status_code = 200;
					response.statusCode = 200;
					response.setHeader("Content-Type", "text/html; charset=utf-8");
					response.end(createAuthCallbackSuccessHtml());
				})
				.catch((error) => {
					wideEvent.outcome = "error";
					wideEvent.status_code = 500;
					wideEvent.error_code = "auth_callback_failed";
					recordWideEventError({
						error,
						event: wideEvent,
						operation: "auth_callback",
					});
					const message =
						error instanceof Error ? error.message : "Authentication failed.";
					response.statusCode = 500;
					response.setHeader("Content-Type", "text/plain; charset=utf-8");
					response.end(message);
				});
			return;
		}

		if (localRouteHandler || hostedRoute) {
			const wideEvent = createWideEvent({
				event: "desktop.local_api.request",
				request,
			});
			wideEvent.route = requestPath;
			wideEvent.is_reconnect_route = isReconnectRoute;
			wideEvent.request_origin = request.headers.origin ?? null;
			emitLocalRequestWideEventOnCompletion({
				event: wideEvent,
				response,
				startedAt,
			});

			if (request.method === "OPTIONS") {
				if (
					setCorsHeadersForLocalAppRequest(request, response, allowedOrigins)
				) {
					wideEvent.outcome = "success";
					wideEvent.status_code = 204;
					wideEvent.cors_preflight = true;
					response.statusCode = 204;
					response.end();
					return;
				}
			}

			if (!isAuthorizedLocalAppRequest(request, allowedOrigins)) {
				wideEvent.outcome = "error";
				wideEvent.status_code = 403;
				wideEvent.error_code = "forbidden_origin";
				sendJson(response, 403, {
					error: "Forbidden",
				});
				return;
			}

			setCorsHeadersForLocalAppRequest(request, response, allowedOrigins);

			const expectedMethod = hostedRoute?.method ?? "POST";
			if (request.method !== expectedMethod) {
				wideEvent.outcome = "error";
				wideEvent.status_code = 405;
				wideEvent.error_code = "method_not_allowed";
				sendJson(response, 405, { error: "Method not allowed." });
				return;
			}

			const routeRequest = hostedRoute
				? handleHostedAiProxyRequest(request, response, hostedRoute)
				: localRouteHandler(request, response);
			void routeRequest.catch((error) => {
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = "route_handler_failed";
				recordWideEventError({
					error,
					event: wideEvent,
					operation: "route_handler",
				});
				const message =
					error instanceof Error ? error.message : "Unexpected server error.";
				sendJson(response, 500, { error: message });
			});
			return;
		}

		const wideEvent = createWideEvent({
			event: "desktop.local_api.request",
			request,
		});
		wideEvent.route = requestPath;
		wideEvent.outcome = "error";
		wideEvent.status_code = 404;
		wideEvent.error_code = "route_not_found";
		emitLocalRequestWideEventOnCompletion({
			event: wideEvent,
			response,
			startedAt,
		});
		response.statusCode = 404;
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ error: "Not found." }));
	});

	let lastListenError = null;

	for (const port of preferredLocalServerPorts) {
		try {
			await new Promise((resolvePromise, rejectPromise) => {
				server.once("error", rejectPromise);
				server.listen(port, "127.0.0.1", () => {
					server.off("error", rejectPromise);
					resolvePromise();
				});
			});
			lastListenError = null;
			break;
		} catch (error) {
			server.removeAllListeners("error");
			lastListenError = error;
		}
	}

	if (lastListenError !== null && !server.listening) {
		await new Promise((resolvePromise, rejectPromise) => {
			server.once("error", rejectPromise);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", rejectPromise);
				resolvePromise();
			});
		});
	}

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Local desktop server did not expose a TCP port.");
	}

	localServerOrigin = `http://127.0.0.1:${address.port}`;

	return {
		origin: localServerOrigin,
		close: () =>
			new Promise((resolvePromise, rejectPromise) => {
				server.close((error) => {
					if (error) {
						rejectPromise(error);
						return;
					}

					resolvePromise();
				});
			}),
	};
};
