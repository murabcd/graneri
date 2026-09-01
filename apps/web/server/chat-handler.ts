import type { IncomingMessage, ServerResponse } from "node:http";
import { createChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { parseChatSettings } from "@workspace/ai/chat-settings";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import {
	getHostedChatConvexRouteError,
	getHostedChatSteerTelemetry,
	type HostedChatTurnIntent,
	parseHostedChatTurnIntent,
	validateHostedChatRequestInput,
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
import { createHostedChatRouteErrorResponder } from "./chat-turn-route-errors.js";
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
	HostedActiveStreamSession<Id<"assistantRuns">, Id<"assistantQueuedMessages">>
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
	const routeErrors = createHostedChatRouteErrorResponder({
		emitWideEvent,
		response,
		sendJson,
		wideEvent,
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
		continueRunId: requestedContinueRunId,
		replayQueuedMessageId: requestedReplayQueuedMessageId,
		replayQueuedMessageStatus: requestedReplayQueuedMessageStatus,
		supersedeActiveRun = false,
		steerQueuedMessageId: requestedSteerQueuedMessageId,
	} = await readJsonBody<ChatRequestBody>(request);
	const hasRequestedLocalCapabilitySession =
		requestedLocalCapabilitySession !== null &&
		requestedLocalCapabilitySession !== undefined;
	const localCapabilitySession = hasRequestedLocalCapabilitySession
		? parseLocalCapabilitySession(requestedLocalCapabilitySession)
		: null;
	if (hasRequestedLocalCapabilitySession && !localCapabilitySession) {
		routeErrors.send({
			eventErrorCode: "local_capability_session_invalid",
			payload: {
				error: "Local capability session is invalid.",
				errorCode: "local_capability_session_invalid",
			},
			statusCode: 400,
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
		routeErrors.send({
			eventErrorCode: "chat_settings_invalid",
			payload: {
				error: "Complete valid chat settings are required.",
				errorCode: "chat_settings_invalid",
			},
			statusCode: 400,
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
	const parsedTurnIntent = parseHostedChatTurnIntent({
		continueRunId: requestedContinueRunId,
		hasMessage: Boolean(message),
		isSteerRoute: options.isSteerRoute === true,
		replayQueuedMessageId: requestedReplayQueuedMessageId,
		replayQueuedMessageStatus: requestedReplayQueuedMessageStatus,
		steerQueuedMessageId: requestedSteerQueuedMessageId,
	});
	if (!parsedTurnIntent.ok) {
		routeErrors.send({
			eventErrorCode: parsedTurnIntent.errorCode,
			payload: {
				error: parsedTurnIntent.error,
				errorCode: parsedTurnIntent.errorCode,
			},
			statusCode: parsedTurnIntent.statusCode,
		});
		return;
	}
	const turnIntent = parsedTurnIntent.intent as HostedChatTurnIntent<
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>;
	const continueRunId =
		turnIntent.type === "steer"
			? turnIntent.runId
			: turnIntent.type === "direct"
				? turnIntent.continueRunId
				: null;
	wideEvent.continue_run_id = continueRunId;
	wideEvent.replay_queued_message_id =
		turnIntent.type === "replay" ? turnIntent.queuedMessageId : null;
	wideEvent.steer_queued_message_id =
		turnIntent.type === "steer" ? turnIntent.queuedMessageId : null;
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
		message,
		turnIntent,
	});
	if (inputValidation) {
		routeErrors.send({
			eventErrorCode: inputValidation.errorCode,
			payload: inputValidation.payload,
			statusCode: inputValidation.statusCode,
		});
		return;
	}

	if (
		!id ||
		!convexToken ||
		!resolvedWorkspaceId ||
		resolvedProjectId === undefined
	) {
		routeErrors.send({
			eventErrorCode: "chat_auth_context_missing",
			payload: {
				error:
					"chat id, convexToken, workspaceId, and an explicit project selection are required.",
			},
			statusCode: 400,
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
		if (!routeErrors.sendConvexError(error)) {
			throw error;
		}
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
		if (!routeErrors.sendConvexError(error)) {
			throw error;
		}
		return;
	}
	if (
		continueRunId &&
		attachableRun &&
		(attachableRun.localCapabilitySession?.id ?? null) !==
			(localCapabilitySession?.id ?? null)
	) {
		routeErrors.send({
			eventErrorCode: "local_capability_session_mismatch",
			payload: {
				error: "This run requires its original local capability session.",
				errorCode: "local_capability_session_mismatch",
			},
			statusCode: 409,
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
			localCapabilitySession,
			mentions,
			message,
			messageId,
			noteContext,
			projectId: resolvedProjectId,
			recipeSlug,
			selectedSourceIds,
			turnIntent,
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
			assistantMessageId: attachableRun.assistantMessageId,
			stopReason: "user_requested",
		});
	}

	await interruptHostedChatRun({
		activeStreamSessions: activeChatStreamControllers,
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		runId: attachableRun._id,
		assistantMessageId: attachableRun.assistantMessageId,
		stopActiveStream: (args) =>
			convexClient.mutation(api.chats.stopActiveStream, args),
	});
	if (!interruptActiveRun) {
		await convexClient.mutation(api.assistantRuns.finishStoppedAssistantRun, {
			runId: attachableRun._id,
			assistantMessageId: attachableRun.assistantMessageId,
		});
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
			assistantMessageId: attachableRun.assistantMessageId,
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
