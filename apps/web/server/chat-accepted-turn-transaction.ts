import type { ChatSettings } from "@workspace/ai/chat-settings";
import {
	getHostedChatReplayAcceptanceHeaders,
	getHostedChatSteerAcceptanceHeaders,
	type HostedChatTurnIntent,
	toHostedStoredMessage,
	validateHostedChatActiveRunPolicy,
} from "@workspace/ai/hosted-chat-runtime";
import {
	type createHostedChatTurnInput,
	persistHostedChatUserMessage,
} from "@workspace/ai/hosted-chat-turn";
import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
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
import {
	createExpectedQueuedTurnAcceptanceReceipt,
	persistQueuedTurnAcceptance,
	type QueuedTurnAcceptance,
} from "./chat-queued-turn-acceptance.js";

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

type QueryCall<Query extends FunctionReference<"query">> = (
	args: FunctionArgs<Query>,
) => Promise<FunctionReturnType<Query>>;

type HostedChatTurnPersistence = {
	acceptQueuedUserMessageAndStartRun: MutationCall<
		typeof api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun
	>;
	acceptSteeredUserMessage: MutationCommand<
		typeof api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage
	>;
	answerUserQuestion: MutationCommand<
		typeof api.assistantRunQuestionAnswers.answer
	>;
	completeLocalFolderToolMessage: MutationCommand<
		typeof api.chats.completeLocalFolderToolMessage
	>;
	getQueuedMessageAcceptanceStatus: QueryCall<
		typeof api.assistantQueuedMessageAcceptances.getAcceptanceStatus
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
	acceptQueuedUserMessageAndStartRun: (args) =>
		client.mutation(
			api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun,
			args,
		),
	acceptSteeredUserMessage: async (args) => {
		await client.mutation(
			api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
			args,
		);
	},
	answerUserQuestion: async (args) => {
		await client.mutation(api.assistantRunQuestionAnswers.answer, args);
	},
	completeLocalFolderToolMessage: async (args) => {
		await client.mutation(api.chats.completeLocalFolderToolMessage, args);
	},
	getQueuedMessageAcceptanceStatus: (args) =>
		client.query(
			api.assistantQueuedMessageAcceptances.getAcceptanceStatus,
			args,
		),
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
	queuedInput: HostedQueuedInput;
	toolApprovalResponse: ToolApprovalResponse | null;
	turnIntent: HostedChatTurnIntent<
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>;
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
	chatId: string;
	defaultTimezone: string;
	localCapabilitySession: LocalCapabilitySession | null;
	noteId: Id<"notes"> | null;
	projectId: Id<"projects"> | null;
	selectedSourceIds: string[];
	settings: ChatSettings;
	supersedeActiveRun?: boolean;
	trigger?: "submit-message" | "regenerate-message";
	workspaceId: Id<"workspaces">;
};

export type HostedChatTurnAcceptanceFailure =
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
	| { type: "claimed_queue_release_failed" }
	| { type: "queued_acceptance_status_lookup"; error: unknown }
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

type HostedChatAcceptedTurn = {
	assistantMessageId: string;
	pendingQueuedAcceptanceHeaders: Record<string, string> | null;
	producer:
		| { type: "web"; assistantRun: HostedAssistantRunIdentity | null }
		| {
				type: "convex";
				assistantRun: HostedAssistantRunIdentity;
		  };
};

type HostedChatTurnAcceptanceResult =
	| { ok: true; acceptedTurn: HostedChatAcceptedTurn }
	| { ok: false; failure: HostedChatTurnAcceptanceFailure };

type AcceptHostedChatTurnArgs = {
	acceptedInput: HostedChatTurnAcceptedInput;
	releaseClaimedQueuedMessage: () => Promise<boolean>;
	onSteerAccepted: (runId: Id<"assistantRuns"> | null) => void;
	onUserMessagePersistenceCompleted: (attempted: boolean) => void;
	persistence: HostedChatTurnPersistence;
	policy: HostedChatTurnAcceptancePolicy;
	preparedRun: HostedChatTurnPreparedPersistence;
};

export const acceptHostedChatTurn = async ({
	acceptedInput,
	releaseClaimedQueuedMessage,
	onSteerAccepted,
	onUserMessagePersistenceCompleted,
	persistence,
	policy,
	preparedRun,
}: AcceptHostedChatTurnArgs): Promise<HostedChatTurnAcceptanceResult> => {
	const {
		attachableRun,
		queuedInput,
		toolApprovalResponse,
		turnIntent,
		turnController,
		userQuestionAnswer,
	} = acceptedInput;
	const continueRunId =
		turnIntent.type === "steer"
			? turnIntent.runId
			: turnIntent.type === "direct"
				? turnIntent.continueRunId
				: null;
	const {
		admissionReservationId,
		appsEnabled,
		chatId,
		defaultTimezone,
		localCapabilitySession,
		noteId,
		projectId,
		selectedSourceIds,
		settings,
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
			turnIntent.type === "steer" &&
			queuedInput.hasClaimed,
	);
	const userQuestionResolution =
		continueRunId &&
		attachableRun?._id === continueRunId &&
		attachableRun.pendingDecision?.type === "user_question" &&
		userQuestionAnswer !== null
			? { answer: userQuestionAnswer, runId: continueRunId }
			: null;
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
		!userQuestionResolution
	) {
		return {
			ok: false,
			failure: { type: "convex_run_continuation_invalid" },
		};
	}

	const assistantMessageId =
		turnIntent.type === "steer" && attachableRun
			? attachableRun.assistantMessageId
			: (assistantContinuationMessageId ?? `stream-${crypto.randomUUID()}`);
	const backgroundRunJob = {
		messagesJson: JSON.stringify(chatMessages),
		instructions,
		chatMode: settings.chatMode,
		webSearchEnabled: coreToolPolicyState.webSearchEnabled,
		artifactAuthoringRequested: coreToolPolicyState.artifactAuthoringRequested,
		chartGenerationRequested: coreToolPolicyState.chartGenerationRequested,
		imageGenerationRequested: coreToolPolicyState.imageGenerationRequested,
		appToolScope: appsEnabled ? ("available" as const) : ("disabled" as const),
		shouldGenerateChatTitle,
		selectedSourceIds: appsEnabled ? selectedSourceIds : [],
		defaultTimezone,
		model: settings.model,
		reasoningEffort: settings.reasoningEffort,
		serviceTier: settings.serviceTier,
	};

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

	if (userQuestionResolution) {
		try {
			await persistence.answerUserQuestion({
				workspaceId,
				chatId,
				admissionReservationId,
				runId: userQuestionResolution.runId,
				nextAssistantMessageId: assistantMessageId,
				answer: userQuestionResolution.answer,
			});
		} catch (error) {
			return {
				ok: false,
				failure: { type: "user_question_answer_persist", error },
			};
		}
	}

	let queuedTurnAcceptance: QueuedTurnAcceptance | null = null;
	if (lastUserMessage) {
		const isQueuedAccept =
			turnIntent.type !== "direct" && queuedInput.hasClaimed;
		const attemptedAcceptanceLease = isQueuedAccept
			? queuedInput.claimedLease
			: null;
		const persistUserMessage =
			async (): Promise<QueuedTurnAcceptance | null> => {
				const persistedUserMessage = await persistHostedChatUserMessage({
					workspaceId,
					chatId,
					noteId,
					projectId,
					settings,
					message: lastUserMessage,
					queuedInput,
					turnIntent,
					acceptQueuedUserMessageAndStartRun: async (args) => {
						const run = shouldUseConvexProducer
							? (() => {
									if (!admissionReservationId) {
										throw new Error(
											"Queued replay admission reservation is missing.",
										);
									}
									return {
										producer: "convex" as const,
										assistantMessageId,
										admissionReservationId,
										job: backgroundRunJob,
									};
								})()
							: {
									producer: "web" as const,
									assistantMessageId,
									localCapabilitySession,
									model: settings.model,
									reasoningEffort: settings.reasoningEffort,
									serviceTier: settings.serviceTier,
								};
						return await persistence.acceptQueuedUserMessageAndStartRun({
							...args,
							run,
						});
					},
					acceptSteeredUserMessage: (args) => {
						if (!attachableRun) {
							throw new Error("Steered assistant run is missing.");
						}
						return persistence.acceptSteeredUserMessage({
							...args,
							assistantMessageId: attachableRun.assistantMessageId,
							admissionReservationId,
						});
					},
					saveMessage: persistence.saveMessage,
				});
				if (persistedUserMessage.type === "replay") {
					return {
						type: "replay",
						queuedMessageId: persistedUserMessage.queuedMessageId,
						run: {
							_id: persistedUserMessage.acceptance.run._id,
							assistantMessageId:
								persistedUserMessage.acceptance.run.assistantMessageId,
						},
					};
				}
				if (persistedUserMessage.type === "steer") {
					return persistedUserMessage;
				}
				return null;
			};
		if (attemptedAcceptanceLease) {
			const producer =
				turnIntent.type === "steer"
					? attachableRun?.producer
					: shouldUseConvexProducer
						? "convex"
						: "web";
			if (!producer) {
				return {
					ok: false,
					failure: {
						type: "user_message_persist",
						error: new Error("Steered assistant run is missing."),
						isQueuedAccept,
					},
				};
			}
			const result = await persistQueuedTurnAcceptance({
				clearClaimed: queuedInput.clearClaimed,
				expected: createExpectedQueuedTurnAcceptanceReceipt({
					assistantMessageId,
					claimVersion: attemptedAcceptanceLease.claimVersion,
					messageId: lastUserMessage.id,
					producer,
					queuedMessageId: attemptedAcceptanceLease.queuedMessageId,
					turnIntent,
				}),
				getAcceptanceStatus: () =>
					persistence.getQueuedMessageAcceptanceStatus({
						workspaceId,
						chatId,
						queuedMessageId: attemptedAcceptanceLease.queuedMessageId,
						claimVersion: attemptedAcceptanceLease.claimVersion,
					}),
				persist: async () => {
					const acceptance = await persistUserMessage();
					if (!acceptance) {
						throw new Error("Queued chat input did not produce an acceptance.");
					}
					return acceptance;
				},
				releaseClaimed: releaseClaimedQueuedMessage,
			});
			if (!result.ok) {
				if (result.failure.type === "release_failed") {
					return {
						ok: false,
						failure: { type: "claimed_queue_release_failed" },
					};
				}
				if (result.failure.type === "status_lookup") {
					return {
						ok: false,
						failure: {
							type: "queued_acceptance_status_lookup",
							error: result.failure.error,
						},
					};
				}
				return {
					ok: false,
					failure: {
						type: "user_message_persist",
						error: result.failure.error,
						isQueuedAccept,
					},
				};
			}
			queuedTurnAcceptance = result.acceptance;
		} else {
			try {
				queuedTurnAcceptance = await persistUserMessage();
			} catch (error) {
				return {
					ok: false,
					failure: { type: "user_message_persist", error, isQueuedAccept },
				};
			}
		}
	}
	const pendingQueuedAcceptanceHeaders = queuedTurnAcceptance
		? queuedTurnAcceptance.type === "steer"
			? getHostedChatSteerAcceptanceHeaders({
					queuedMessageId: queuedTurnAcceptance.queuedMessageId,
					turnId: queuedTurnAcceptance.runId,
				})
			: getHostedChatReplayAcceptanceHeaders({
					queuedMessageId: queuedTurnAcceptance.queuedMessageId,
				})
		: null;
	if (queuedTurnAcceptance?.type === "steer") {
		onSteerAccepted(queuedTurnAcceptance.runId);
	}
	const acceptedReplayRun =
		queuedTurnAcceptance?.type === "replay" ? queuedTurnAcceptance.run : null;
	onUserMessagePersistenceCompleted(Boolean(lastUserMessage));

	if (!shouldUseConvexProducer) {
		return {
			ok: true,
			acceptedTurn: {
				assistantMessageId,
				pendingQueuedAcceptanceHeaders,
				producer: { type: "web", assistantRun: acceptedReplayRun },
			},
		};
	}

	if (!admissionReservationId && !acceptedReplayRun) {
		return {
			ok: false,
			failure: {
				type: "ai_admission_reservation_missing",
				pendingQueuedAcceptanceHeaders,
			},
		};
	}

	let assistantRun: HostedAssistantRunIdentity;
	if (acceptedReplayRun) {
		assistantRun = acceptedReplayRun;
	} else if (attachableRun) {
		assistantRun = {
			_id: attachableRun._id,
			assistantMessageId,
		};
	} else {
		try {
			if (!admissionReservationId) {
				throw new Error("Assistant run admission reservation is missing.");
			}
			const startedRun = await persistence.startBackgroundRun({
				workspaceId,
				chatId,
				assistantMessageId,
				admissionReservationId,
				policy: supersedeActiveRun ? "supersede" : "reject",
				job: backgroundRunJob,
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
