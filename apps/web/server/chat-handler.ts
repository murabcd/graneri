import type { IncomingMessage, ServerResponse } from "node:http";
import { createChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { parseChatSettings } from "@workspace/ai/chat-settings";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import {
	getHostedChatConvexRouteError,
	getHostedChatSteerTelemetry,
	validateHostedChatRequestInput,
	validateHostedChatSteerRoute,
} from "@workspace/ai/hosted-chat-runtime";
import {
	createHostedActiveStreamKey,
	type HostedActiveStreamSession,
	stopOrphanedHostedAssistantRun,
} from "@workspace/ai/hosted-chat-turn";
import { parseLocalCapabilitySession } from "@workspace/ai/local-capability-session";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
	getChatModel,
	getOpenAiModelProviderOptions,
} from "../src/lib/ai/models.js";
import type {
	AttachableAssistantRun,
	ChatRequestBody,
} from "./chat-handler-types.js";
import { executeHostedChatTurn } from "./chat-turn-execution.js";
import {
	interruptHostedChatRun,
	pipeHostedActiveStreamSessionToResponse,
} from "./chat-turn-stream-runtime.js";
import { admitHostedOpenAiRequest } from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
} from "./server-logger.js";

const activeChatStreamControllers = new Map<
	string,
	HostedActiveStreamSession
>();
const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const sendHostedChatConvexRouteError = (
	response: ServerResponse,
	error: unknown,
) => {
	const routeError = getHostedChatConvexRouteError(error);
	if (!routeError) {
		return false;
	}
	sendJson(response, routeError.statusCode, {
		error: routeError.error,
		errorCode: routeError.errorCode,
	});
	return true;
};

export const handleChatRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
	options: { isSteerRoute?: boolean } = {},
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "chat.request",
		request,
	});
	let acceptedSteerTurnId: string | null = null;
	const emitWideEvent = createServerWideEventEmitter({
		event: wideEvent,
		startedAt,
		beforeEmit: () => {
			const steerTelemetry = getHostedChatSteerTelemetry({
				acceptedTurnId: acceptedSteerTurnId,
				errorCode:
					typeof wideEvent.error_code === "string"
						? wideEvent.error_code
						: null,
				expectedTurnId:
					typeof wideEvent.continue_run_id === "string"
						? wideEvent.continue_run_id
						: null,
				isSteerRoute: wideEvent.is_steer_route === true,
				outcome:
					wideEvent.outcome === "success" || wideEvent.outcome === "error"
						? wideEvent.outcome
						: null,
				queuedMessageId:
					typeof wideEvent.steer_queued_message_id === "string"
						? wideEvent.steer_queued_message_id
						: null,
			});
			if (steerTelemetry) {
				Object.assign(wideEvent, steerTelemetry);
			}
		},
	});

	const {
		id,
		chatMode: requestedChatMode,
		trigger,
		messageId,
		message,
		model: requestedModel,
		reasoningEffort: requestedReasoningEffort,
		serviceTier: requestedServiceTier,
		projectId: requestedProjectId,
		workspaceId,
		webSearchEnabled: requestedWebSearchEnabled,
		appsEnabled = true,
		mentions,
		selectedSourceIds,
		timezone,
		localCapabilitySession: requestedLocalCapabilitySession = null,
		convexToken,
		recipeSlug,
		noteContext,
		continueRunId,
		replayQueuedMessageId,
		supersedeActiveRun = false,
		steerQueuedMessageId,
	} = await readJsonBody<ChatRequestBody>(request);
	const hasRequestedLocalCapabilitySession =
		requestedLocalCapabilitySession !== null &&
		requestedLocalCapabilitySession !== undefined;
	const localCapabilitySession = hasRequestedLocalCapabilitySession
		? parseLocalCapabilitySession(requestedLocalCapabilitySession)
		: null;
	if (hasRequestedLocalCapabilitySession && !localCapabilitySession) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "local_capability_session_invalid";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "Local capability session is invalid.",
			errorCode: "local_capability_session_invalid",
		});
		return;
	}
	const settings = parseChatSettings({
		chatMode: requestedChatMode,
		model: requestedModel,
		reasoningEffort: requestedReasoningEffort,
		serviceTier: requestedServiceTier,
		webSearchEnabled: requestedWebSearchEnabled,
	});
	if (!settings) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "chat_settings_invalid";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "Complete valid chat settings are required.",
			errorCode: "chat_settings_invalid",
		});
		return;
	}
	const { chatMode, model, reasoningEffort, serviceTier, webSearchEnabled } =
		settings;
	wideEvent.chat_id = id ?? null;
	wideEvent.chat_mode = chatMode;
	wideEvent.workspace_id = workspaceId ?? null;
	wideEvent.project_id = requestedProjectId ?? null;
	wideEvent.trigger = trigger ?? null;
	wideEvent.model = model;
	wideEvent.reasoning_effort = reasoningEffort;
	wideEvent.service_tier = serviceTier;
	wideEvent.is_steer_route = options.isSteerRoute === true;
	wideEvent.continue_run_id = continueRunId ?? null;
	wideEvent.replay_queued_message_id = replayQueuedMessageId ?? null;
	wideEvent.steer_queued_message_id = steerQueuedMessageId ?? null;
	const steerRouteValidation = validateHostedChatSteerRoute({
		continueRunId,
		hasMessage: Boolean(message),
		isSteerRoute: options.isSteerRoute === true,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (steerRouteValidation) {
		wideEvent.outcome = "error";
		wideEvent.status_code = steerRouteValidation.statusCode;
		wideEvent.error_code = steerRouteValidation.errorCode;
		emitWideEvent("error");
		sendJson(response, steerRouteValidation.statusCode, {
			error: steerRouteValidation.error,
			errorCode: steerRouteValidation.errorCode,
		});
		return;
	}
	wideEvent.web_search_enabled = webSearchEnabled;
	wideEvent.apps_enabled = appsEnabled;
	wideEvent.mention_count = mentions?.length ?? 0;
	wideEvent.selected_source_count = selectedSourceIds?.length ?? 0;
	wideEvent.has_local_capability_session = Boolean(localCapabilitySession);
	wideEvent.has_note_context = Boolean(noteContext);
	wideEvent.has_recipe = Boolean(recipeSlug);
	const logLatency = createChatLatencyLogger({
		chatId: id,
		enabled: AI_LATENCY_DEBUG_ENABLED,
		model,
		reasoningEffort,
	});
	logLatency("request.body_read", {
		appsEnabled,
		hasMessage: Boolean(message),
		hasNoteContext: Boolean(noteContext),
		webSearchEnabled,
	});

	const resolvedWorkspaceId =
		(workspaceId as Id<"workspaces"> | null | undefined) ?? null;
	const resolvedProjectId =
		requestedProjectId === null
			? null
			: typeof requestedProjectId === "string" && requestedProjectId.trim()
				? (requestedProjectId as Id<"projects">)
				: undefined;
	const resolvedTimezone = timezone?.trim() || "UTC";

	const inputValidation = validateHostedChatRequestInput({
		allowLocalFolderToolContinuation: Boolean(localCapabilitySession),
		continueRunId,
		message,
		replayQueuedMessageId,
		steerQueuedMessageId,
	});
	if (inputValidation) {
		wideEvent.outcome = "error";
		wideEvent.status_code = inputValidation.statusCode;
		wideEvent.error_code = inputValidation.errorCode;
		emitWideEvent("error");
		sendJson(response, inputValidation.statusCode, inputValidation.payload);
		return;
	}

	if (
		!id ||
		!convexToken ||
		!resolvedWorkspaceId ||
		resolvedProjectId === undefined
	) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "chat_auth_context_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error:
				"chat id, convexToken, workspaceId, and an explicit project selection are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});
	let storedChat: {
		noteId?: Id<"notes"> | null;
		title?: string | null;
	} | null;
	try {
		storedChat = await convexClient.query(api.chats.getSession, {
			workspaceId: resolvedWorkspaceId,
			chatId: id,
		});
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			throw error;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = routeError.statusCode;
		wideEvent.error_code = routeError.errorCode;
		emitWideEvent("error");
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}
	logLatency("convex.session_loaded", {
		hasStoredChat: Boolean(storedChat),
	});
	const resolvedModel = getChatModel(model);
	const resolvedNoteId =
		(noteContext?.noteId as Id<"notes"> | null | undefined) ??
		storedChat?.noteId ??
		null;
	let attachableRun: AttachableAssistantRun | null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			throw error;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = routeError.statusCode;
		wideEvent.error_code = routeError.errorCode;
		emitWideEvent("error");
		sendJson(response, routeError.statusCode, {
			error: routeError.error,
			errorCode: routeError.errorCode,
		});
		return;
	}
	if (
		continueRunId &&
		attachableRun &&
		(attachableRun.localCapabilitySession?.id ?? null) !==
			(localCapabilitySession?.id ?? null)
	) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 409;
		wideEvent.error_code = "local_capability_session_mismatch";
		emitWideEvent("error");
		sendJson(response, 409, {
			error: "This run requires its original local capability session.",
			errorCode: "local_capability_session_mismatch",
		});
		return;
	}
	const admission = await admitHostedOpenAiRequest({
		client: convexClient,
		onRejected: ({ errorCode, statusCode }) => {
			wideEvent.outcome = "error";
			wideEvent.status_code = statusCode;
			wideEvent.error_code = errorCode;
			emitWideEvent("error");
		},
		operation: "chat-turn",
		request,
		requireServerApiKey:
			attachableRun?.producer === "web" || Boolean(localCapabilitySession),
		response,
	});
	if (!admission) {
		return;
	}
	const providerOptions = getOpenAiModelProviderOptions(resolvedModel.model, {
		reasoningEffort,
		safetyIdentifier: admission.safetyIdentifier,
		serviceTier,
	});
	logLatency("chat.model_resolved", {
		hasProviderOptions: Boolean(providerOptions),
		model: resolvedModel.model,
		reasoningEffort,
		serviceTier,
	});
	await executeHostedChatTurn({
		admission: {
			admissionReservationId: admission.admissionReservationId,
			safetyIdentifier: admission.safetyIdentifier,
		},
		attachableRun,
		environment: {
			activeStreamSessions: activeChatStreamControllers,
			client: convexClient,
			emitEvent: emitWideEvent,
			logLatency,
			onSteerAccepted: (runId) => {
				acceptedSteerTurnId = runId;
			},
			response,
			sendJson,
			wideEvent,
		},
		model: {
			defaultTimezone: resolvedTimezone,
			generateTitleOnFirstUserMessage:
				!storedChat || storedChat.title === "New chat",
			noteId: resolvedNoteId,
			providerOptions,
		},
		request: {
			appsEnabled,
			chatId: id,
			continueRunId,
			localCapabilitySession,
			mentions,
			message,
			messageId,
			noteContext,
			projectId: resolvedProjectId,
			recipeSlug,
			replayQueuedMessageId,
			selectedSourceIds,
			steerQueuedMessageId,
			supersedeActiveRun,
			trigger,
			workspaceId: resolvedWorkspaceId,
		},
		settings,
	});
};

export const handleChatStopRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const {
		id,
		workspaceId,
		convexToken,
		interruptActiveRun = false,
	} = await readJsonBody<ChatRequestBody>(request);
	const resolvedWorkspaceId =
		(workspaceId as Id<"workspaces"> | null | undefined) ?? null;

	if (!id || !resolvedWorkspaceId || !convexToken) {
		sendJson(response, 400, {
			error: "id, workspaceId, and convexToken are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});

	let attachableRun: AttachableAssistantRun | null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId: resolvedWorkspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		if (sendHostedChatConvexRouteError(response, error)) {
			return;
		}
		throw error;
	}

	if (!attachableRun) {
		sendJson(response, 200, { ok: true });
		return;
	}

	if (!interruptActiveRun && attachableRun.status !== "stopping") {
		await convexClient.mutation(api.assistantRuns.requestStopAssistantRun, {
			runId: attachableRun._id,
			stopReason: "user_requested",
		});
	}

	try {
		await interruptHostedChatRun({
			activeStreamSessions: activeChatStreamControllers,
			workspaceId: resolvedWorkspaceId,
			chatId: id,
			client: convexClient,
			runId: attachableRun._id,
		});
	} finally {
		if (!interruptActiveRun) {
			await convexClient.mutation(api.assistantRuns.finishStoppedAssistantRun, {
				runId: attachableRun._id,
			});
		}
	}

	sendJson(response, 200, { ok: true });
};

export const handleChatReconnectRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	const match = /^\/api\/chat\/([^/]+)\/stream$/.exec(requestUrl.pathname);
	const id = match?.[1] ? decodeURIComponent(match[1]) : null;
	const workspaceId = requestUrl.searchParams.get(
		"workspaceId",
	) as Id<"workspaces"> | null;
	const convexToken = getBearerTokenFromAuthorizationHeader(
		request.headers.authorization,
	);

	if (!id || !workspaceId || !convexToken) {
		sendJson(response, 400, {
			error: "chat id, workspaceId, and convexToken are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});
	let attachableRun: AttachableAssistantRun | null;
	try {
		attachableRun = await convexClient.query(
			api.assistantRuns.getAttachableRun,
			{
				workspaceId,
				chatId: id,
			},
		);
	} catch (error) {
		if (sendHostedChatConvexRouteError(response, error)) {
			return;
		}
		throw error;
	}

	if (!attachableRun) {
		response.statusCode = 204;
		response.end();
		return;
	}

	if (attachableRun.status === "waiting_for_user") {
		response.statusCode = 204;
		response.end();
		return;
	}

	if (attachableRun.producer === "convex") {
		response.statusCode = 204;
		response.end();
		return;
	}

	const streamKey = createHostedActiveStreamKey({
		workspaceId,
		chatId: id,
	});
	const activeSession = activeChatStreamControllers.get(streamKey);

	if (!activeSession || activeSession.persister.runId !== attachableRun._id) {
		if (
			attachableRun.localCapabilitySession &&
			(attachableRun.pendingLocalCapabilityToolCalls?.length ?? 0) > 0
		) {
			response.statusCode = 204;
			response.end();
			return;
		}
		await stopOrphanedHostedAssistantRun({
			chatId: id,
			finishStoppedAssistantRun: (args) =>
				convexClient.mutation(
					api.assistantRuns.finishStoppedAssistantRun,
					args,
				),
			logLatency: createChatLatencyLogger({
				chatId: id,
				enabled: AI_LATENCY_DEBUG_ENABLED,
			}),
			requestStopAssistantRun: (args) =>
				convexClient.mutation(api.assistantRuns.requestStopAssistantRun, args),
			runId: attachableRun._id,
			stopActiveStream: (args) =>
				convexClient.mutation(api.chats.stopActiveStream, args),
			workspaceId,
		});
		response.statusCode = 204;
		response.end();
		return;
	}

	pipeHostedActiveStreamSessionToResponse({
		activeStreamSession: activeSession,
		response,
	});
};
