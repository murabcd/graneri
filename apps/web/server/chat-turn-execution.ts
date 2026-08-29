import { getSelectedNoteSourceIds } from "@workspace/ai/capability-metadata";
import type { ChatSettings } from "@workspace/ai/chat-settings";
import {
	buildHostedNotesContext,
	getHostedChatConvexRouteError,
	getHostedChatInputValidationErrorResponse,
	getStoredHostedNoteContext,
	validateHostedChatInput,
} from "@workspace/ai/hosted-chat-runtime";
import {
	createHostedChatTurnInput,
	type HostedActiveStreamSession,
} from "@workspace/ai/hosted-chat-turn";
import { getHostedUserQuestionAnswer } from "@workspace/ai/hosted-user-question";
import { isLocalFolderToolContinuationMessage } from "@workspace/ai/local-folder-tool-contract";
import {
	getToolApprovalResponse,
	getToolApprovalResponses,
} from "@workspace/ai/tool-approval-state";
import { loadWorkspaceToolConnections } from "@workspace/ai/workspace-tool-catalog";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import { createCanonicalChatAssistantContinuation } from "./chat-assistant-continuation.js";
import {
	prepareServerAssistantRunInput,
	type ServerAssistantRunCompletionInput,
	type ServerAssistantRunContext,
} from "./chat-assistant-run-input.js";
import { createHostedChatAutomationActions } from "./chat-automation-actions.js";
import type {
	AttachableAssistantRun,
	ChatRequestBody,
} from "./chat-handler-types.js";
import { createHostedChatTurnRouteErrorResponder } from "./chat-turn-route-errors.js";
import {
	type HostedChatTurnRouteEnvironment,
	interruptHostedChatRun,
	runHostedChatTurnStreamRuntime,
} from "./chat-turn-stream-runtime.js";
import { recordServerError } from "./server-logger.js";

type HostedChatTurnRequest = Pick<
	ChatRequestBody,
	| "appsEnabled"
	| "continueRunId"
	| "localFolders"
	| "mentions"
	| "message"
	| "messageId"
	| "noteContext"
	| "recipeSlug"
	| "replayQueuedMessageId"
	| "selectedSourceIds"
	| "steerQueuedMessageId"
	| "supersedeActiveRun"
	| "trigger"
> & {
	chatId: string;
	projectId: Id<"projects"> | null;
	workspaceId: Id<"workspaces">;
};

type HostedChatTurnModel = Pick<
	ServerAssistantRunCompletionInput,
	"defaultTimezone" | "providerOptions"
> & {
	generateTitleOnFirstUserMessage: boolean;
	noteId: Id<"notes"> | null;
};

type HostedChatTurnAdmission = {
	admissionReservationId?: Id<"aiAdmissionReservations">;
	safetyIdentifier: string;
};

type ExecuteHostedChatTurnArgs = {
	admission: HostedChatTurnAdmission;
	attachableRun: AttachableAssistantRun | null;
	environment: HostedChatTurnRouteEnvironment;
	model: HostedChatTurnModel;
	request: HostedChatTurnRequest;
	settings: ChatSettings;
};

const loadNotesContext = async ({
	client,
	mentions,
	workspaceId,
}: {
	client: ConvexHttpClient;
	mentions?: string[];
	workspaceId: Id<"workspaces">;
}) => {
	const noteIds = getSelectedNoteSourceIds({ mentions }) as Id<"notes">[];
	const notes =
		noteIds.length > 0
			? await client.query(api.notes.getChatContext, {
					workspaceId,
					ids: noteIds,
				})
			: [];

	return buildHostedNotesContext(notes);
};

const loadAppConnections = async ({
	client,
	workspaceId,
}: {
	client: ConvexHttpClient;
	workspaceId: Id<"workspaces">;
}) =>
	await loadWorkspaceToolConnections([
		{
			label: "Google",
			load: async () =>
				await client.action(api.googleTools.listAvailableSources, {
					workspaceId,
				}),
		},
		{
			label: "Connected app",
			load: async () =>
				await client.query(api.appConnections.listSources, { workspaceId }),
		},
	]);

const loadSelectedRecipe = async ({
	client,
	recipeSlug,
	workspaceId,
}: {
	client: ConvexHttpClient;
	recipeSlug?: string | null;
	workspaceId: Id<"workspaces">;
}) => {
	if (!recipeSlug) {
		return null;
	}
	const recipes = await client.query(api.recipes.list, { workspaceId });
	const selectedRecipe = recipes.find((recipe) => recipe.slug === recipeSlug);
	if (!selectedRecipe) {
		throw new Error("The selected recipe is no longer available.");
	}
	return selectedRecipe;
};

const loadStoredNoteContext = async ({
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
	return getStoredHostedNoteContext(notes[0]);
};

export const executeHostedChatTurn = async ({
	admission,
	attachableRun,
	environment,
	model,
	request,
	settings,
}: ExecuteHostedChatTurnArgs) => {
	const {
		activeStreamSessions,
		client,
		emitEvent,
		logLatency,
		response,
		sendJson,
		wideEvent,
	} = environment;
	const {
		appsEnabled = true,
		chatId,
		continueRunId,
		localFolders = [],
		mentions,
		message,
		messageId,
		noteContext,
		projectId,
		recipeSlug,
		replayQueuedMessageId,
		selectedSourceIds,
		steerQueuedMessageId,
		supersedeActiveRun,
		trigger,
		workspaceId,
	} = request;
	const { chatMode, webSearchEnabled } = settings;
	const pendingUserQuestion =
		attachableRun?.pendingDecision?.type === "user_question"
			? attachableRun.pendingDecision
			: null;
	const { queuedInput, turnController } = createHostedChatTurnInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>({
		workspaceId,
		chatId,
		claimReadyForRun: (args) =>
			client.mutation(api.assistantQueuedMessages.claimReadyForRun, args),
		discardClaimed: (args) =>
			client.mutation(api.assistantQueuedMessages.discardClaimed, args),
		getClaimedForChat: (args) =>
			client.query(api.assistantQueuedMessages.getClaimedForChat, args),
		attachableRun,
		interruptActiveRun: (args) =>
			attachableRun?.producer === "convex"
				? Promise.resolve([...args.pendingInput])
				: interruptHostedChatRun({
						...args,
						activeStreamSessions,
						client,
					}),
		validateInput: (inputMessage) => {
			if (
				getToolApprovalResponse(inputMessage) ||
				(pendingUserQuestion &&
					getHostedUserQuestionAnswer({
						message: inputMessage,
						decision: pendingUserQuestion,
					}) !== null) ||
				(localFolders.length > 0 &&
					isLocalFolderToolContinuationMessage(inputMessage))
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
		emitWideEvent: emitEvent,
		response,
		sendJson,
		turnController,
		wideEvent,
	});
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
		emitEvent("error");
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
	const userQuestionAnswer = pendingUserQuestion
		? getHostedUserQuestionAnswer({
				message: effectiveMessage,
				decision: pendingUserQuestion,
			})
		: null;
	if (pendingUserQuestion && continueRunId && userQuestionAnswer === null) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "user_question_answer_invalid";
		emitEvent("error");
		sendJson(response, 400, {
			error: "Questionnaire continuation is missing its tool answer.",
			errorCode: "user_question_answer_invalid",
		});
		return;
	}
	let activeStreamSession: HostedActiveStreamSession<
		Id<"assistantRuns">
	> | null = null;
	let assistantRun: ServerAssistantRunContext;
	let toolApprovalResponse: ReturnType<typeof getToolApprovalResponse>;
	try {
		toolApprovalResponse = getToolApprovalResponse(effectiveMessage);
		const preparedAssistantRunInput = await prepareServerAssistantRunInput({
			anchorMessageId: effectiveMessage.id,
			attachableRunId: attachableRun?._id,
			chatId,
			continueRunId,
			convexClient: client,
			logLatency,
			message: effectiveMessage,
			messageId:
				toolApprovalResponse ||
				userQuestionAnswer !== null ||
				isLocalFolderToolContinuation
					? undefined
					: messageId,
			onBranchError: async ({ error, messageId: branchMessageId }) => {
				if (
					queuedInput.hasClaimed &&
					!(await turnRouteErrors.cleanupClaimedSteerQueuedMessage(
						"steer_queue_branch_create_cleanup",
					))
				) {
					return true;
				}
				recordServerError({
					details: { message_id: branchMessageId },
					error,
					event: wideEvent,
					operation: "branch_create",
				});
				const routeError = getHostedChatConvexRouteError(error);
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError?.statusCode ?? 500;
				wideEvent.error_code = routeError?.errorCode ?? "branch_create_failed";
				emitEvent("error");
				sendJson(response, routeError?.statusCode ?? 500, {
					error: routeError?.error ?? "Failed to prepare edited chat branch.",
					...(routeError && { errorCode: routeError.errorCode }),
				});
				return true;
			},
			pendingMessages: pendingSteerMessages,
			prepareMessage:
				toolApprovalResponse ||
				userQuestionAnswer !== null ||
				isLocalFolderToolContinuation
					? ({ storedMessages }) =>
							createCanonicalChatAssistantContinuation({
								approval: toolApprovalResponse
									? {
											response: toolApprovalResponse,
											responses: getToolApprovalResponses(effectiveMessage),
										}
									: null,
								localFolderToolContinuation: isLocalFolderToolContinuation
									? effectiveMessage
									: null,
								storedMessage: storedMessages.find(
									(storedMessage) => storedMessage.id === effectiveMessage.id,
								),
								userQuestion:
									userQuestionAnswer !== null && pendingUserQuestion
										? {
												answer: userQuestionAnswer,
												decision: pendingUserQuestion,
											}
										: null,
							})
					: undefined,
			safetyIdentifier: admission.safetyIdentifier,
			trigger,
			workspaceId,
		});
		if (!preparedAssistantRunInput.ok) {
			return;
		}
		assistantRun = await preparedAssistantRunInput.complete({
			appsEnabled,
			chatMode,
			automationActions: createHostedChatAutomationActions({
				chatId,
				convexClient: client,
				workspaceId,
			}),
			chatAttachmentsApi: api.chatAttachments,
			chatId,
			convexClient: client,
			defaultModel: settings.model,
			defaultReasoningEffort: settings.reasoningEffort,
			defaultServiceTier: settings.serviceTier,
			defaultTimezone: model.defaultTimezone,
			getActiveStreamSession: () => activeStreamSession,
			getNotesContext: () =>
				loadNotesContext({ client, mentions, workspaceId }),
			getAppConnections: () => loadAppConnections({ client, workspaceId }),
			getSelectedRecipe: ({ recipeSlug: selectedRecipeSlug }) =>
				loadSelectedRecipe({
					client,
					recipeSlug: selectedRecipeSlug,
					workspaceId,
				}),
			getStoredNoteContext: () => {
				if (!model.noteId) {
					throw new Error("Stored note context requires a resolved note id.");
				}
				return loadStoredNoteContext({
					client,
					noteId: model.noteId,
					workspaceId,
				});
			},
			getUserProfileContext: () =>
				client.query(api.userPreferences.getAiProfileContext, {}),
			localFolders,
			logLatency,
			message: effectiveMessage,
			noteContext,
			noteId: model.noteId,
			providerOptions: model.providerOptions,
			publishRunPlan: async (plan) => {
				const runId = activeStreamSession?.persister.runId;
				if (!runId) {
					throw new Error("Run activity requires an active assistant run.");
				}
				await client.mutation(api.assistantRunActivity.publishPlan, {
					runId,
					plan,
				});
			},
			recipeSlug,
			selectedSourceIds,
			webSearchEnabled,
			workspaceId,
		});
		logLatency("chat.messages_validated", {
			chatMessageCount: assistantRun.chatMessages.length,
		});
	} catch (error) {
		if (queuedInput.hasClaimed) {
			if (
				!(await turnRouteErrors.cleanupClaimedSteerQueuedMessage(
					"steer_run_prepare_cleanup",
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
				operation: "steer_run_prepare",
			});
			emitEvent("error");
			sendJson(response, 500, {
				error: "Failed to prepare steered assistant run.",
			});
			return;
		}
		const routeError = getHostedChatConvexRouteError(error);
		if (routeError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = routeError.statusCode;
			wideEvent.error_code = routeError.errorCode;
			emitEvent("error");
			sendJson(response, routeError.statusCode, {
				error: routeError.error,
				errorCode: routeError.errorCode,
			});
			return;
		}
		throw error;
	}

	const localFolderContinuationMessage = isLocalFolderToolContinuation
		? assistantRun.inputMessage
		: undefined;
	if (isLocalFolderToolContinuation && !localFolderContinuationMessage) {
		throw new Error("Local folder tool continuation was not prepared.");
	}

	const lastUserMessage =
		effectiveMessage.role === "user" ? effectiveMessage : undefined;
	const result = await runHostedChatTurnStreamRuntime({
		acceptedInput: {
			attachableRun,
			continueRunId,
			queuedInput,
			replayQueuedMessageId,
			steeredUserMessages,
			toolApprovalResponse,
			turnController,
			userQuestionAnswer,
		},
		environment,
		policy: {
			admissionReservationId: admission.admissionReservationId,
			appsEnabled,
			chatId,
			defaultTimezone: model.defaultTimezone,
			noteId: model.noteId,
			projectId,
			safetyIdentifier: admission.safetyIdentifier,
			selectedSourceIds: appsEnabled ? (selectedSourceIds ?? []) : [],
			settings,
			supersedeActiveRun,
			trigger,
			workspaceId,
		},
		preparedRun: {
			agent: assistantRun.agent,
			appConnections: assistantRun.appConnections,
			assistantContinuationMessageId: isLocalFolderToolContinuation
				? effectiveMessage.id
				: undefined,
			chatMessages: assistantRun.chatMessages,
			coreToolPolicyState: assistantRun.coreToolPolicyState,
			finalizedToolSet: assistantRun.finalizedToolSet,
			instructions: assistantRun.instructions,
			lastUserMessage,
			localFolderContinuationMessage:
				localFolderContinuationMessage ?? undefined,
			localFolderRoots: assistantRun.localFolderRoots,
			shouldGenerateChatTitle: Boolean(
				lastUserMessage && model.generateTitleOnFirstUserMessage,
			),
		},
	});
	activeStreamSession = result.activeStreamSession;
};
