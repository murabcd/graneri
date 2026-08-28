import type { ChatMode } from "@workspace/ai/chat-mode";
import {
	getHostedChatConvexRouteError,
	toHostedStoredMessage,
	validateHostedChatActiveRunPolicy,
} from "@workspace/ai/hosted-chat-runtime";
import {
	type createHostedChatTurnInput,
	isHostedQueuedUserMessageAccept,
	persistHostedChatUserMessage,
} from "@workspace/ai/hosted-chat-turn";
import type { ReasoningEffort, ServiceTier } from "@workspace/ai/models";
import type { ToolApprovalResponse } from "@workspace/ai/tool-approval-state";
import type { UIMessage } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ServerAssistantRunContext } from "./chat-assistant-run-input.js";
import type { AttachableAssistantRun } from "./chat-handler-types.js";

type HostedTurnInput = ReturnType<
	typeof createHostedChatTurnInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>
>;

type HostedQueuedInput = HostedTurnInput["queuedInput"];
type HostedTurnController = HostedTurnInput["turnController"];
type SameActiveRunResult = Awaited<
	ReturnType<HostedTurnController["requireSameActiveRun"]>
>;
type SameActiveRunFailure = Exclude<SameActiveRunResult, { ok: true }>;

type MutationCommand<Mutation extends FunctionReference<"mutation">> = (
	args: FunctionArgs<Mutation>,
) => Promise<void>;

type MutationCall<Mutation extends FunctionReference<"mutation">> = (
	args: FunctionArgs<Mutation>,
) => Promise<FunctionReturnType<Mutation>>;

export type HostedChatTurnPersistence = {
	acceptQueuedUserMessage: MutationCommand<
		typeof api.chats.acceptQueuedUserMessage
	>;
	acceptSteeredUserMessages: MutationCommand<
		typeof api.chats.acceptSteeredUserMessages
	>;
	answerUserQuestion: MutationCommand<
		typeof api.assistantRunQuestionAnswers.answer
	>;
	completeLocalFolderToolMessage: MutationCommand<
		typeof api.chats.completeLocalFolderToolMessage
	>;
	persistToolApprovalResponse: MutationCommand<
		typeof api.toolApprovals.acceptResponse
	>;
	saveMessage: MutationCommand<typeof api.chats.saveMessage>;
	startBackgroundRun: MutationCall<typeof api.assistantRunBackground.start>;
};

export const createHostedChatTurnPersistence = (
	client: ConvexHttpClient,
): HostedChatTurnPersistence => ({
	acceptQueuedUserMessage: async (args) => {
		await client.mutation(api.chats.acceptQueuedUserMessage, args);
	},
	acceptSteeredUserMessages: async (args) => {
		await client.mutation(api.chats.acceptSteeredUserMessages, args);
	},
	answerUserQuestion: async (args) => {
		await client.mutation(api.assistantRunQuestionAnswers.answer, args);
	},
	completeLocalFolderToolMessage: async (args) => {
		await client.mutation(api.chats.completeLocalFolderToolMessage, args);
	},
	persistToolApprovalResponse: async (args) => {
		await client.mutation(api.toolApprovals.acceptResponse, args);
	},
	saveMessage: async (args) => {
		await client.mutation(api.chats.saveMessage, args);
	},
	startBackgroundRun: (args) =>
		client.mutation(api.assistantRunBackground.start, args),
});

export type HostedChatTurnAcceptedInput = {
	attachableRun: AttachableAssistantRun | null;
	continueRunId?: Id<"assistantRuns"> | null;
	queuedInput: HostedQueuedInput;
	replayQueuedMessageId?: Id<"assistantQueuedMessages"> | null;
	steeredUserMessages: UIMessage[];
	toolApprovalResponse: ToolApprovalResponse | null;
	turnController: HostedTurnController;
	userQuestionAnswer: string | null;
};

export type HostedChatTurnPreparedPersistence = Pick<
	ServerAssistantRunContext,
	"chatMessages" | "coreToolPolicyState" | "instructions" | "localFolderRoots"
> & {
	assistantContinuationMessageId?: string;
	lastUserMessage?: UIMessage;
	localFolderContinuationMessage?: UIMessage;
	shouldGenerateChatTitle: boolean;
};

export type HostedChatTurnAcceptancePolicy = {
	admissionReservationId?: Id<"aiAdmissionReservations">;
	appsEnabled: boolean;
	chatMode: ChatMode;
	chatId: string;
	defaultTimezone: string;
	model: string;
	noteId: Id<"notes"> | null;
	reasoningEffort: ReasoningEffort;
	selectedSourceIds: string[];
	serviceTier: ServiceTier;
	supersedeActiveRun?: boolean;
	trigger?: "submit-message" | "regenerate-message";
	workspaceId: Id<"workspaces">;
};

type HostedChatTurnAcceptanceFailure =
	| {
			type: "active_run_policy";
			error: NonNullable<ReturnType<typeof validateHostedChatActiveRunPolicy>>;
	  }
	| { type: "same_active_run"; error: SameActiveRunFailure }
	| { type: "desktop_local_tools_require_new_run" }
	| { type: "convex_run_continuation_invalid" }
	| { type: "local_tool_message_persist"; error: unknown }
	| { type: "tool_approval_persist"; error: unknown }
	| { type: "user_question_answer_persist"; error: unknown }
	| {
			type: "user_message_persist";
			error: unknown;
			isQueuedAccept: boolean;
	  }
	| { type: "claimed_queue_cleanup_failed" }
	| {
			type: "ai_admission_reservation_missing";
			pendingQueuedAcceptanceHeaders: Record<string, string> | null;
	  }
	| {
			type: "background_run_start";
			error: unknown;
			pendingQueuedAcceptanceHeaders: Record<string, string> | null;
	  };

type HostedAssistantRunIdentity = {
	_id: Id<"assistantRuns">;
	assistantMessageId: string;
};

export type HostedChatAcceptedTurn = {
	assistantMessageId: string;
	pendingQueuedAcceptanceHeaders: Record<string, string> | null;
	producer:
		| { type: "web" }
		| {
				type: "convex";
				assistantRun: HostedAssistantRunIdentity;
		  };
};

export type HostedChatTurnAcceptanceResult =
	| { ok: true; acceptedTurn: HostedChatAcceptedTurn }
	| { ok: false; failure: HostedChatTurnAcceptanceFailure };

type AcceptHostedChatTurnArgs = {
	acceptedInput: HostedChatTurnAcceptedInput;
	cleanupClaimedSteerQueuedMessage: (options: {
		tolerateMissing: boolean;
	}) => Promise<boolean>;
	onSteerAccepted: (runId: Id<"assistantRuns"> | null) => void;
	onUserMessagePersistenceCompleted: (attempted: boolean) => void;
	persistence: HostedChatTurnPersistence;
	policy: HostedChatTurnAcceptancePolicy;
	preparedRun: HostedChatTurnPreparedPersistence;
};

export const acceptHostedChatTurn = async ({
	acceptedInput,
	cleanupClaimedSteerQueuedMessage,
	onSteerAccepted,
	onUserMessagePersistenceCompleted,
	persistence,
	policy,
	preparedRun,
}: AcceptHostedChatTurnArgs): Promise<HostedChatTurnAcceptanceResult> => {
	const {
		attachableRun,
		continueRunId,
		queuedInput,
		replayQueuedMessageId,
		steeredUserMessages,
		toolApprovalResponse,
		turnController,
		userQuestionAnswer,
	} = acceptedInput;
	const {
		admissionReservationId,
		appsEnabled,
		chatMode,
		chatId,
		defaultTimezone,
		model,
		noteId,
		reasoningEffort,
		selectedSourceIds,
		serviceTier,
		supersedeActiveRun,
		trigger,
		workspaceId,
	} = policy;
	const {
		assistantContinuationMessageId,
		chatMessages,
		coreToolPolicyState,
		instructions,
		lastUserMessage,
		localFolderContinuationMessage,
		localFolderRoots,
		shouldGenerateChatTitle,
	} = preparedRun;

	const activeRunPolicyError = validateHostedChatActiveRunPolicy({
		attachableRun,
		continueRunId,
		supersedeActiveRun,
		trigger,
	});
	if (activeRunPolicyError) {
		return {
			ok: false,
			failure: { type: "active_run_policy", error: activeRunPolicyError },
		};
	}

	const sameActiveRun = await turnController.requireSameActiveRun({
		continueRunId,
	});
	if (!sameActiveRun.ok) {
		return {
			ok: false,
			failure: { type: "same_active_run", error: sameActiveRun },
		};
	}

	const isSteeringConvexRun = Boolean(
		attachableRun?.producer === "convex" &&
			continueRunId &&
			queuedInput.hasClaimed,
	);
	const isAnsweringUserQuestion = Boolean(
		continueRunId &&
			attachableRun?._id === continueRunId &&
			attachableRun.pendingDecision?.type === "user_question" &&
			userQuestionAnswer !== null,
	);
	const shouldUseConvexProducer =
		attachableRun?.producer === "convex" ||
		(!attachableRun && localFolderRoots.length === 0);

	if (attachableRun?.producer === "convex" && localFolderRoots.length > 0) {
		return {
			ok: false,
			failure: { type: "desktop_local_tools_require_new_run" },
		};
	}
	if (
		attachableRun?.producer === "convex" &&
		!toolApprovalResponse &&
		!isSteeringConvexRun &&
		!isAnsweringUserQuestion
	) {
		return {
			ok: false,
			failure: { type: "convex_run_continuation_invalid" },
		};
	}

	const assistantMessageId =
		assistantContinuationMessageId ?? `stream-${crypto.randomUUID()}`;

	if (localFolderContinuationMessage) {
		try {
			await persistence.completeLocalFolderToolMessage({
				workspaceId,
				chatId,
				message: toHostedStoredMessage(localFolderContinuationMessage),
			});
		} catch (error) {
			return {
				ok: false,
				failure: { type: "local_tool_message_persist", error },
			};
		}
	}

	if (toolApprovalResponse) {
		try {
			const approvalMessage = chatMessages.at(-1);
			if (
				!continueRunId ||
				!approvalMessage ||
				approvalMessage.role !== "assistant" ||
				approvalMessage.id !== toolApprovalResponse.assistantMessageId
			) {
				throw new Error(
					"Tool approval response requires its pending assistant run.",
				);
			}
			await persistence.persistToolApprovalResponse({
				workspaceId,
				chatId,
				admissionReservationId,
				message: {
					id: approvalMessage.id,
					role: approvalMessage.role,
					partsJson: JSON.stringify(approvalMessage.parts),
					metadataJson: approvalMessage.metadata
						? JSON.stringify(approvalMessage.metadata)
						: undefined,
					text: "",
					createdAt: Date.now(),
				},
				runId: continueRunId,
				nextAssistantMessageId: assistantMessageId,
			});
		} catch (error) {
			return {
				ok: false,
				failure: { type: "tool_approval_persist", error },
			};
		}
	}

	if (isAnsweringUserQuestion) {
		try {
			if (!continueRunId || userQuestionAnswer === null) {
				throw new Error("Question answer requires its pending assistant run.");
			}
			await persistence.answerUserQuestion({
				workspaceId,
				chatId,
				admissionReservationId,
				runId: continueRunId,
				nextAssistantMessageId: assistantMessageId,
				answer: userQuestionAnswer,
			});
		} catch (error) {
			return {
				ok: false,
				failure: { type: "user_question_answer_persist", error },
			};
		}
	}

	let pendingQueuedAcceptanceHeaders: Record<string, string> | null = null;
	if (lastUserMessage) {
		const isQueuedAccept = isHostedQueuedUserMessageAccept({
			continueRunId,
			queuedInput,
			replayQueuedMessageId,
		});
		try {
			const persistedUserMessage = await persistHostedChatUserMessage({
				workspaceId,
				chatId,
				noteId,
				model,
				nextAssistantMessageId: assistantMessageId,
				reasoningEffort,
				message: lastUserMessage,
				continueRunId,
				queuedInput,
				replayQueuedMessageId,
				steeredUserMessages,
				acceptQueuedUserMessage: persistence.acceptQueuedUserMessage,
				acceptSteeredUserMessages: (args) =>
					persistence.acceptSteeredUserMessages({
						...args,
						admissionReservationId,
					}),
				saveMessage: persistence.saveMessage,
			});
			pendingQueuedAcceptanceHeaders =
				persistedUserMessage.pendingQueuedAcceptanceHeaders;
			onSteerAccepted(persistedUserMessage.acceptedSteerTurnId);
		} catch (error) {
			const routeError = isQueuedAccept
				? getHostedChatConvexRouteError(error)
				: null;
			const cleaned = await cleanupClaimedSteerQueuedMessage({
				tolerateMissing: Boolean(routeError),
			});
			if (!cleaned) {
				return {
					ok: false,
					failure: { type: "claimed_queue_cleanup_failed" },
				};
			}
			return {
				ok: false,
				failure: { type: "user_message_persist", error, isQueuedAccept },
			};
		}
	}
	onUserMessagePersistenceCompleted(Boolean(lastUserMessage));

	if (!shouldUseConvexProducer) {
		return {
			ok: true,
			acceptedTurn: {
				assistantMessageId,
				pendingQueuedAcceptanceHeaders,
				producer: { type: "web" },
			},
		};
	}

	if (!admissionReservationId) {
		return {
			ok: false,
			failure: {
				type: "ai_admission_reservation_missing",
				pendingQueuedAcceptanceHeaders,
			},
		};
	}

	let assistantRun: HostedAssistantRunIdentity | null = attachableRun
		? {
				_id: attachableRun._id,
				assistantMessageId:
					attachableRun.producer === "convex"
						? assistantMessageId
						: attachableRun.assistantMessageId,
			}
		: null;
	if (!assistantRun) {
		try {
			const startedRun = await persistence.startBackgroundRun({
				workspaceId,
				chatId,
				assistantMessageId,
				admissionReservationId,
				policy: supersedeActiveRun ? "supersede" : "reject",
				job: {
					messagesJson: JSON.stringify(chatMessages),
					instructions,
					chatMode,
					webSearchEnabled: coreToolPolicyState.webSearchEnabled,
					chartGenerationRequested:
						coreToolPolicyState.chartGenerationRequested,
					imageGenerationRequested:
						coreToolPolicyState.imageGenerationRequested,
					appToolScope: appsEnabled ? "available" : "disabled",
					shouldGenerateChatTitle,
					selectedSourceIds: appsEnabled ? selectedSourceIds : [],
					defaultTimezone,
					model,
					reasoningEffort,
					serviceTier,
				},
			});
			assistantRun = {
				_id: startedRun._id,
				assistantMessageId: startedRun.assistantMessageId,
			};
		} catch (error) {
			return {
				ok: false,
				failure: {
					type: "background_run_start",
					error,
					pendingQueuedAcceptanceHeaders,
				},
			};
		}
	}

	return {
		ok: true,
		acceptedTurn: {
			assistantMessageId,
			pendingQueuedAcceptanceHeaders,
			producer: { type: "convex", assistantRun },
		},
	};
};
