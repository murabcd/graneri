import type { IncomingMessage, ServerResponse } from "node:http";
import { getSelectedNoteSourceIds } from "@workspace/ai/capability-metadata";
import { createChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { getBearerTokenFromAuthorizationHeader } from "@workspace/ai/hosted-chat-http";
import {
	buildHostedNotesContext,
	getHostedChatConvexRouteError,
	getHostedChatInputValidationErrorResponse,
	getHostedChatSteerTelemetry,
	getStoredHostedNoteContext,
	toHostedStoredMessage,
	validateHostedChatInput,
	validateHostedChatRequestInput,
	validateHostedChatSteerRoute,
} from "@workspace/ai/hosted-chat-runtime";
import {
	createHostedActiveStreamKey,
	createHostedChatTurnInput,
	type HostedActiveStreamSession,
	type prepareHostedAssistantRunInput,
	stopOrphanedHostedAssistantRun,
} from "@workspace/ai/hosted-chat-turn";
import {
	createCanonicalLocalFolderToolContinuation,
	isLocalFolderToolContinuationMessage,
} from "@workspace/ai/local-folder-tool-contract";
import { resolveLocalFolderRoots } from "@workspace/ai/local-folder-tools";
import {
	createCanonicalToolApprovalResponse,
	getToolApprovalResponse,
	getToolApprovalResponses,
	type ToolApprovalResponse,
} from "@workspace/ai/tool-approval-state";
import { loadWorkspaceToolConnections } from "@workspace/ai/workspace-tool-catalog";
import type { UIMessage } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
	findChatModel,
	getOpenAiModelProviderOptions,
	normalizeReasoningEffort,
	normalizeServiceTier,
} from "../src/lib/ai/models.js";
import { prepareServerAssistantRunInput } from "./chat-assistant-run-input.js";
import { createHostedChatAutomationActions } from "./chat-automation-actions.js";
import type {
	AttachableAssistantRun,
	ChatRequestBody,
} from "./chat-handler-types.js";
import { createHostedChatTurnRouteErrorResponder } from "./chat-turn-route-errors.js";
import {
	pipeHostedActiveStreamSessionToResponse,
	runHostedChatTurnStreamRuntime,
} from "./chat-turn-stream-runtime.js";
import { admitHostedOpenAiRequest } from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
	recordServerError,
} from "./server-logger.js";

const activeChatStreamControllers = new Map<
	string,
	HostedActiveStreamSession
>();
const AI_LATENCY_DEBUG_ENABLED = process.env.GRANERI_AI_LATENCY_DEBUG === "1";

type PreparedHostedAssistantRunInput = Extract<
	Awaited<ReturnType<typeof prepareHostedAssistantRunInput>>,
	{ ok: true }
>;
type HostedChatRunContext = Awaited<
	ReturnType<PreparedHostedAssistantRunInput["complete"]>
>;

const canUseLocalFolderTools = () => process.env.GRANERI_ENV_MODE === "local";

const interruptActiveChatRun = async ({
	chatId,
	client,
	pendingInput = [],
	runId,
	workspaceId,
}: {
	chatId: string;
	client: ConvexHttpClient;
	pendingInput?: readonly unknown[];
	runId: Id<"assistantRuns">;
	workspaceId: Id<"workspaces">;
}) => {
	const streamKey = createHostedActiveStreamKey({
		workspaceId,
		chatId,
	});
	const activeSession = activeChatStreamControllers.get(streamKey);
	if (pendingInput.length > 0) {
		activeSession?.turnInput.extendSteerInput([...pendingInput]);
	}
	const drainedPendingInput =
		activeSession?.turnInput.takeForCurrentTurn() ?? [];
	activeSession?.abort("stopped");
	if (activeSession) {
		activeSession.cleanup();
	}

	await client.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId,
	});

	return drainedPendingInput;
};

const getConvexUrl = () => {
	const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;

	if (!value) {
		throw new Error("CONVEX_URL is not configured.");
	}

	return value;
};

const getNotesContext = async ({
	convexToken,
	mentions,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "mentions" | "workspaceId">) => {
	if (!convexToken || !workspaceId) {
		return "";
	}

	const noteIds = getSelectedNoteSourceIds({ mentions }) as Id<"notes">[];
	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId: workspaceId as Id<"workspaces">,
					ids: noteIds,
				})
			: [];

	return buildHostedNotesContext(notes);
};

const getAppConnections = async ({
	convexToken,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "workspaceId">) => {
	if (!convexToken || !workspaceId) {
		return [];
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });

	return await loadWorkspaceToolConnections([
		{
			label: "Google",
			load: async () =>
				await client.action(api.googleTools.listAvailableSources, {
					workspaceId: workspaceId as Id<"workspaces">,
				}),
		},
		{
			label: "Connected app",
			load: async () =>
				await client.query(api.appConnections.listSources, {
					workspaceId: workspaceId as Id<"workspaces">,
				}),
		},
	]);
};

const getSelectedRecipe = async ({
	convexToken,
	recipeSlug,
	workspaceId,
}: Pick<ChatRequestBody, "convexToken" | "recipeSlug" | "workspaceId">) => {
	if (!recipeSlug) {
		return null;
	}
	if (!convexToken || !workspaceId) {
		throw new Error("Recipe selection requires an authenticated workspace.");
	}

	const client = new ConvexHttpClient(getConvexUrl(), { auth: convexToken });
	const recipes = await client.query(api.recipes.list, {
		workspaceId: workspaceId as Id<"workspaces">,
	});

	const selectedRecipe = recipes.find((recipe) => recipe.slug === recipeSlug);
	if (!selectedRecipe) {
		throw new Error("The selected recipe is no longer available.");
	}
	return selectedRecipe;
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

const getStoredNoteContext = async ({
	client,
	noteId,
	workspaceId,
}: {
	client: ConvexHttpClient;
	noteId: Id<"notes">;
	workspaceId: Id<"workspaces">;
}) => {
	const notes = await client.query(api.notes.getChatContext, {
		workspaceId,
		ids: [noteId],
	});
	const note = notes[0];

	return getStoredHostedNoteContext(note);
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
		trigger,
		messageId,
		message,
		model,
		reasoningEffort,
		serviceTier,
		workspaceId,
		webSearchEnabled = false,
		appsEnabled = true,
		mentions,
		selectedSourceIds,
		timezone,
		localFolders = [],
		convexToken,
		recipeSlug,
		noteContext,
		continueRunId,
		replayQueuedMessageId,
		supersedeActiveRun = false,
		steerQueuedMessageId,
	} = await readJsonBody<ChatRequestBody>(request);
	wideEvent.chat_id = id ?? null;
	wideEvent.workspace_id = workspaceId ?? null;
	wideEvent.trigger = trigger ?? null;
	wideEvent.model = model ?? null;
	wideEvent.reasoning_effort = reasoningEffort ?? null;
	wideEvent.service_tier = serviceTier ?? null;
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
	wideEvent.local_folder_count = localFolders.length;
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
	const resolvedTimezone = timezone?.trim() || "UTC";

	const inputValidation = validateHostedChatRequestInput({
		allowLocalFolderToolContinuation: localFolders.length > 0,
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

	if (!id || !convexToken || !resolvedWorkspaceId) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "chat_auth_context_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "chat id, convexToken, and workspaceId are required.",
		});
		return;
	}

	const convexClient = new ConvexHttpClient(getConvexUrl(), {
		auth: convexToken,
	});
	let storedChat: {
		model?: string | null;
		noteId?: Id<"notes"> | null;
		reasoningEffort?: string | null;
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
	const requestedModel = model ?? storedChat?.model ?? null;

	if (!requestedModel) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "model_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "model is required.",
		});
		return;
	}

	const resolvedModel = findChatModel(requestedModel);

	if (!resolvedModel) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "model_unsupported";
		wideEvent.requested_model = requestedModel;
		emitWideEvent("error");
		sendJson(response, 400, {
			error: `Unsupported model: ${requestedModel}.`,
		});
		return;
	}
	const requestedReasoningEffort =
		reasoningEffort ?? storedChat?.reasoningEffort ?? undefined;
	const resolvedReasoningEffort = normalizeReasoningEffort(
		requestedReasoningEffort,
	);
	const resolvedServiceTier = normalizeServiceTier(serviceTier);
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
			attachableRun?.producer === "web" || localFolders.length > 0,
		response,
	});
	if (!admission) {
		return;
	}
	const providerOptions = getOpenAiModelProviderOptions(resolvedModel.model, {
		reasoningEffort: resolvedReasoningEffort,
		safetyIdentifier: admission.safetyIdentifier,
		serviceTier: resolvedServiceTier,
	});
	logLatency("chat.model_resolved", {
		hasProviderOptions: Boolean(providerOptions),
		model: resolvedModel.model,
		reasoningEffort: resolvedReasoningEffort,
		serviceTier: resolvedServiceTier,
	});
	const { queuedInput, turnController } = createHostedChatTurnInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>({
		workspaceId: resolvedWorkspaceId,
		chatId: id,
		claimReadyForRun: (args) =>
			convexClient.mutation(api.assistantQueuedMessages.claimReadyForRun, args),
		discardClaimed: (args) =>
			convexClient.mutation(api.assistantQueuedMessages.discardClaimed, args),
		getClaimedForChat: (args) =>
			convexClient.query(api.assistantQueuedMessages.getClaimedForChat, args),
		attachableRun,
		interruptActiveRun: (args) =>
			attachableRun?.producer === "convex"
				? Promise.resolve([...args.pendingInput])
				: interruptActiveChatRun({ ...args, client: convexClient }),
		validateInput: (inputMessage) => {
			if (getToolApprovalResponse(inputMessage)) {
				return { ok: true };
			}
			if (
				localFolders.length > 0 &&
				isLocalFolderToolContinuationMessage(inputMessage)
			) {
				return { ok: true };
			}
			try {
				validateHostedChatInput(inputMessage);
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					...getHostedChatInputValidationErrorResponse(error).payload,
				};
			}
		},
	});
	const turnRouteErrors = createHostedChatTurnRouteErrorResponder({
		continueRunId,
		emitWideEvent,
		response,
		sendJson,
		turnController,
		wideEvent,
	});
	const failClaimedSteerPreparation = async (
		error: unknown,
		operation: string,
	) => {
		if (
			!(await turnRouteErrors.cleanupClaimedSteerQueuedMessage(
				`${operation}_cleanup`,
			))
		) {
			return;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "steer_preparation_failed";
		recordServerError({
			error,
			event: wideEvent,
			operation,
		});
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "Failed to prepare steered assistant run.",
		});
	};
	let preparedTurnInput: Awaited<
		ReturnType<typeof turnController.prepareInput>
	>;
	try {
		preparedTurnInput = await turnController.prepareInput({
			continueRunId,
			message,
			replayQueuedMessageId,
			steerQueuedMessageId,
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
	if (!preparedTurnInput.ok) {
		turnRouteErrors.sendTurnControllerError(preparedTurnInput);
		return;
	}
	const { effectiveMessage, pendingSteerMessages, steeredUserMessages } =
		preparedTurnInput;
	const isLocalFolderToolContinuation =
		localFolders.length > 0 &&
		isLocalFolderToolContinuationMessage(effectiveMessage);
	const cleanupClaimedSteerQueuedMessage = async (
		operation: string,
		options: { tolerateMissing?: boolean } = {},
	) =>
		await turnRouteErrors.cleanupClaimedSteerQueuedMessage(operation, options);
	let appConnections: HostedChatRunContext["appConnections"];
	let localFolderRoots: HostedChatRunContext["localFolderRoots"];
	let agent: HostedChatRunContext["agent"];
	let finalizedToolSet: HostedChatRunContext["finalizedToolSet"];
	let coreToolPolicyState: HostedChatRunContext["coreToolPolicyState"];
	let instructions: string;
	let chatMessages: UIMessage[];
	let lastUserMessage: UIMessage | undefined;
	let toolApprovalResponse: ToolApprovalResponse | null;
	let inputMessage: UIMessage | null | undefined;
	let shouldGenerateChatTitle: boolean;
	let activeStreamSession: HostedActiveStreamSession | null = null;
	try {
		toolApprovalResponse = getToolApprovalResponse(effectiveMessage);
		const currentToolApprovalResponse = toolApprovalResponse;
		const preparedAssistantRunInput = await prepareServerAssistantRunInput({
			anchorMessageId: effectiveMessage.id,
			attachableRunId: attachableRun?._id,
			chatId: id,
			continueRunId,
			convexClient,
			logLatency,
			message: effectiveMessage,
			messageId:
				toolApprovalResponse || isLocalFolderToolContinuation
					? undefined
					: messageId,
			onBranchError: async ({ error, messageId: branchMessageId }) => {
				if (
					queuedInput.hasClaimed &&
					!(await cleanupClaimedSteerQueuedMessage(
						"steer_queue_branch_create_cleanup",
					))
				) {
					return true;
				}
				recordServerError({
					details: {
						message_id: branchMessageId,
					},
					error,
					event: wideEvent,
					operation: "branch_create",
				});
				const routeError = getHostedChatConvexRouteError(error);
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError?.statusCode ?? 500;
				wideEvent.error_code = routeError?.errorCode ?? "branch_create_failed";
				emitWideEvent("error");
				sendJson(response, routeError?.statusCode ?? 500, {
					error: routeError?.error ?? "Failed to prepare edited chat branch.",
					...(routeError && { errorCode: routeError.errorCode }),
				});
				return true;
			},
			pendingMessages: pendingSteerMessages,
			prepareMessage: currentToolApprovalResponse
				? ({ storedMessages }) =>
						createCanonicalToolApprovalResponse({
							approvalResponse: currentToolApprovalResponse,
							approvalResponses: getToolApprovalResponses(effectiveMessage),
							storedMessage: storedMessages.find(
								(storedMessage) =>
									storedMessage.id ===
									currentToolApprovalResponse.assistantMessageId,
							),
						})
				: isLocalFolderToolContinuation
					? ({ storedMessages }) =>
							createCanonicalLocalFolderToolContinuation({
								message: effectiveMessage,
								storedMessage: storedMessages.find(
									(storedMessage) => storedMessage.id === effectiveMessage.id,
								),
							})
					: undefined,
			safetyIdentifier: admission.safetyIdentifier,
			trigger,
			workspaceId: resolvedWorkspaceId,
		});
		if (!preparedAssistantRunInput.ok) {
			return;
		}
		({
			agent,
			chatMessages,
			coreToolPolicyState,
			finalizedToolSet,
			instructions,
			inputMessage,
			localFolderRoots,
			appConnections,
		} = await preparedAssistantRunInput.complete({
			appsEnabled,
			automationActions: createHostedChatAutomationActions({
				convexClient,
				workspaceId: resolvedWorkspaceId,
			}),
			chatAttachmentsApi: api.chatAttachments,
			chatId: id,
			convexClient,
			defaultModel: resolvedModel.model,
			defaultReasoningEffort: resolvedReasoningEffort,
			defaultServiceTier: resolvedServiceTier,
			defaultTimezone: resolvedTimezone,
			getActiveStreamSession: () => activeStreamSession,
			getNotesContext: () =>
				getNotesContext({
					convexToken,
					mentions,
					workspaceId,
				}),
			getAppConnections: () =>
				getAppConnections({
					convexToken,
					workspaceId,
				}),
			getSelectedRecipe: (args) =>
				getSelectedRecipe({
					convexToken,
					recipeSlug: args.recipeSlug,
					workspaceId: args.workspaceId,
				}),
			getStoredNoteContext: () =>
				(async () => {
					if (!resolvedNoteId) {
						throw new Error("Stored note context requires a resolved note id.");
					}
					return await getStoredNoteContext({
						client: convexClient,
						noteId: resolvedNoteId,
						workspaceId: resolvedWorkspaceId,
					});
				})(),
			getUserProfileContext: () =>
				convexClient.query(api.userPreferences.getAiProfileContext, {}),
			localFolders,
			localFolderToolMode: canUseLocalFolderTools() ? "server" : "client",
			logLatency,
			message: effectiveMessage,
			noteContext,
			noteId: resolvedNoteId,
			providerOptions,
			recipeSlug,
			resolveLocalFolderRoots: (folderPaths) =>
				canUseLocalFolderTools() ? resolveLocalFolderRoots(folderPaths) : [],
			selectedSourceIds,
			webSearchEnabled,
			workspaceId: resolvedWorkspaceId,
		}));
		logLatency("chat.messages_validated", {
			chatMessageCount: chatMessages.length,
		});
		lastUserMessage =
			effectiveMessage.role === "user" ? effectiveMessage : undefined;
		shouldGenerateChatTitle = Boolean(
			lastUserMessage && (!storedChat || storedChat.title === "New chat"),
		);
	} catch (error) {
		if (queuedInput.hasClaimed) {
			await failClaimedSteerPreparation(error, "steer_run_prepare");
			return;
		}
		const routeError = getHostedChatConvexRouteError(error);
		if (routeError) {
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
		throw error;
	}
	if (isLocalFolderToolContinuation) {
		if (!inputMessage) {
			throw new Error("Local folder tool continuation was not prepared.");
		}
		try {
			await convexClient.mutation(api.chats.completeLocalFolderToolMessage, {
				workspaceId: resolvedWorkspaceId,
				chatId: id,
				message: toHostedStoredMessage(inputMessage),
			});
		} catch (error) {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "local_tool_message_persist_failed";
			recordServerError({
				error,
				event: wideEvent,
				operation: "local_tool_message_persist",
			});
			emitWideEvent("error");
			sendJson(response, 500, {
				error: "Failed to persist local folder tool output.",
			});
			return;
		}
	}

	const streamRuntimeResult = await runHostedChatTurnStreamRuntime({
		activeChatStreamControllers,
		admissionReservationId: admission.admissionReservationId as
			| Id<"aiAdmissionReservations">
			| undefined,
		agent,
		appsEnabled,
		attachableRun,
		chatId: id,
		chatMessages,
		convexClient,
		continueRunId,
		coreToolPolicyState,
		defaultTimezone: resolvedTimezone,
		emitWideEvent,
		finalizedToolSet,
		instructions,
		lastUserMessage,
		localFolderRoots,
		logLatency,
		model: resolvedModel.model,
		noteId: resolvedNoteId,
		queuedInput,
		reasoningEffort: resolvedReasoningEffort,
		serviceTier: resolvedServiceTier,
		safetyIdentifier: admission.safetyIdentifier,
		replayQueuedMessageId,
		response,
		sendJson,
		setAcceptedSteerTurnId: (runId) => {
			acceptedSteerTurnId = runId;
		},
		shouldGenerateChatTitle,
		appConnections,
		selectedSourceIds: appsEnabled ? (selectedSourceIds ?? []) : [],
		steeredUserMessages,
		supersedeActiveRun,
		toolApprovalResponse,
		trigger,
		turnController,
		wideEvent,
		workspaceId: resolvedWorkspaceId,
	});
	activeStreamSession = streamRuntimeResult.activeStreamSession;
	if (!streamRuntimeResult.ok) {
		return;
	}
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
		await interruptActiveChatRun({
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
