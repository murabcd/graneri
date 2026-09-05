import { useChat } from "@ai-sdk/react";
import type { HostedHumanDecisionResponse } from "@workspace/ai/hosted-human-decision";
import { HOSTED_REQUEST_USER_INPUT_TOOL_NAME } from "@workspace/ai/hosted-user-question";
import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { UIMessage } from "ai";
import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { getReadyFileParts } from "@/components/ai-elements/file-attachment-utils";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { stopChatInteraction } from "@/lib/chat-interaction-session";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type {
	ChatRequestBody,
	ChatRequestContext,
} from "@/lib/chat-request-preparation";
import { getUIMessageSeedKey } from "@/lib/chat-snapshot";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import { applyPendingBranchReplacement } from "@/lib/chat-thread";
import { executeDesktopLocalToolCall } from "@/lib/desktop-local-tool-call";
import { recoverPendingLocalCapabilityToolCalls } from "@/lib/local-capability-run-recovery";
import { logError } from "@/lib/logger";
import { prepareRendererUserQuestionMessages } from "@/lib/renderer-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useChatInteractionSession } from "./use-chat-interaction-session";
import { useChatTurnAdmission } from "./use-chat-turn-admission";
import { useQueuedChatSession } from "./use-queued-chat-session";
import { useQueuedFollowUps } from "./use-queued-follow-ups";
import { useRendererChatPresentation } from "./use-renderer-chat-presentation";
import { useResumeActiveChatRun } from "./use-resume-active-chat-run";
import { useWorkspaceChatClient } from "./use-workspace-chat-client";

type SubmitRendererChatTurnInput = Omit<
	Parameters<typeof submitChatTurn>[0],
	| "chatId"
	| "currentRunAdmission"
	| "displayActiveRun"
	| "enqueueQueuedMessage"
	| "onOptimisticMessage"
	| "onQueuedMessageSaved"
	| "queueActiveRun"
	| "sendMessage"
	| "workspaceId"
>;

type UpdateQueuedRendererChatTurnInput = Pick<
	SubmitRendererChatTurnInput,
	"buildRequestBody" | "metadata" | "text" | "attachedFiles"
> & {
	onRequestPrepared?: SubmitRendererChatTurnInput["onRequestPrepared"];
};

type SubmitUserQuestionAnswerInput = {
	answer: string;
	onRequestPrepared?: (requestBody: ChatRequestContext) => void;
};

type SubmitHumanDecisionInput = {
	response: HostedHumanDecisionResponse;
	onRequestPrepared?: (requestBody: ChatRequestContext) => void;
};

type RegenerateRendererChatTurnInput = {
	assistantMessageId: string;
	onRequestPrepared: (requestBody: ChatRequestBody) => void;
};

const getAttachableActiveRun = (
	activeRun: AttachableAssistantRunQueryResult,
) => (!activeRun || activeRun.status === "stopping" ? null : activeRun);

const getActivePendingBranchMessageId = ({
	messageId,
	persistedMessages,
}: {
	messageId: string | null;
	persistedMessages: UIMessage[];
}) =>
	messageId && persistedMessages.some((message) => message.id === messageId)
		? messageId
		: null;

const isAiChatRequestPending = (status: string) =>
	status === "submitted" || status === "streaming";

export const useRendererChatSession = ({
	activeRun,
	buildContinuationRequestBody,
	chatId,
	contextLabel,
	isExternallyBlocked = false,
	localCapabilitySession,
	onEditQueuedMessage,
	persistedMessages,
	resumeEnabled = true,
	stopExternalRun,
	workspaceId,
}: {
	activeRun: AttachableAssistantRunQueryResult;
	buildContinuationRequestBody: (
		localCapabilitySession: LocalCapabilitySession | null,
	) => Promise<ChatRequestBody>;
	chatId: string;
	contextLabel: string;
	isExternallyBlocked?: boolean;
	localCapabilitySession: LocalCapabilitySession | null;
	onEditQueuedMessage: (message: QueuedFollowUpMessage) => void;
	persistedMessages: UIMessage[];
	resumeEnabled?: boolean;
	stopExternalRun?: () => Promise<boolean>;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const buildCurrentRequestBody = React.useCallback(
		() => buildContinuationRequestBody(localCapabilitySession),
		[buildContinuationRequestBody, localCapabilitySession],
	);
	const attachableActiveRun = getAttachableActiveRun(activeRun);
	const branchFromMessage = useMutation(api.chatBranches.branchFromMessage);
	const enqueueQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
	);
	const admitQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
	);
	const updateQueuedMessage = useMutation(
		api.assistantQueuedMessages.updateQueued,
	);
	const [pendingBranchMessageId, setPendingBranchMessageId] = React.useState<
		string | null
	>(null);
	const activePendingBranchMessageId = getActivePendingBranchMessageId({
		messageId: pendingBranchMessageId,
		persistedMessages,
	});
	const sessionPersistedMessages = React.useMemo(
		() =>
			applyPendingBranchReplacement(
				persistedMessages,
				activePendingBranchMessageId,
			),
		[activePendingBranchMessageId, persistedMessages],
	);
	const { session: queueSession, snapshot: queueSnapshot } =
		useQueuedChatSession({
			activeRunId: activeRun?._id ?? null,
			scopeKey: `${workspaceId}:${chatId}`,
		});
	const {
		chat,
		fileStorage: localFileStorage,
		latestRequestBodyRef,
	} = useWorkspaceChatClient({
		chatId,
		workspaceId,
		onQueuedAcceptance: queueSession.accept,
	});
	const pendingUserQuestionRollbackRef = React.useRef<{
		assistantMessageId: string;
		chatId: string;
		messages: UIMessage[];
		toolCallId: string;
	} | null>(null);
	const recoveredLocalToolCallsRef = React.useRef(new Set<string>());
	const {
		messages,
		setMessages,
		sendMessage,
		regenerate,
		error,
		status,
		stop,
		resumeStream,
		addToolOutput,
		addToolApprovalResponse,
		clearError,
	} = useChat({
		chat,
	});
	const {
		commitOptimisticMessage,
		isPreparingRequest,
		localOptimisticMessages,
		rollbackOptimisticMessage,
		runPreparedRequest,
		branchMessagesFrom,
	} = useChatInteractionSession({ chatId, setMessages });

	const controllerMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);
	const isAiRequestPending = isAiChatRequestPending(status);
	const isChatRequestPending = isAiRequestPending || isPreparingRequest;
	const {
		activeAssistantMessageId,
		displayActiveRun,
		displayMessages,
		hasLocallyCompletedAssistantMessage,
		localMessageIds,
		pendingHumanDecision,
		queueActiveRun,
		runPlan,
		streamingMessageIds,
	} = useRendererChatPresentation({
		activeRun: attachableActiveRun,
		chatId,
		controllerMessages,
		isAiRequestPending,
		isChatRequestPending,
		localOptimisticMessages,
		persistedMessages: sessionPersistedMessages,
		steerHandoffStreamingMessageIds: queueSnapshot.steerMessageIds,
	});
	const { runTurnAdmission } = useChatTurnAdmission({
		isAiRequestPending,
		queueActiveRun,
		scopeKey: chatId,
	});
	React.useEffect(() => {
		const rollback = pendingUserQuestionRollbackRef.current;
		if (!error || !rollback) return;
		if (rollback.chatId !== chatId) {
			pendingUserQuestionRollbackRef.current = null;
			return;
		}
		pendingUserQuestionRollbackRef.current = null;
		setMessages(rollback.messages);
	}, [chatId, error, setMessages]);
	React.useEffect(() => {
		const rollback = pendingUserQuestionRollbackRef.current;
		if (!rollback) return;
		if (rollback.chatId !== chatId) {
			pendingUserQuestionRollbackRef.current = null;
			return;
		}
		const pendingDecision = attachableActiveRun?.pendingDecision;
		if (
			pendingDecision?.type === "user_question" &&
			pendingDecision.assistantMessageId === rollback.assistantMessageId &&
			pendingDecision.toolCallId === rollback.toolCallId
		) {
			return;
		}
		pendingUserQuestionRollbackRef.current = null;
	}, [attachableActiveRun?.pendingDecision, chatId]);
	useResumeActiveChatRun({
		activeRun: displayActiveRun,
		chatId,
		enabled: resumeEnabled && !isChatRequestPending,
		resumeStream,
		workspaceId,
	});

	const persistedMessagesSeedKey = React.useMemo(
		() => getUIMessageSeedKey(sessionPersistedMessages),
		[sessionPersistedMessages],
	);
	const appliedPersistedMessagesSeedKeyRef = React.useRef(
		persistedMessagesSeedKey,
	);
	const previousChatIdRef = React.useRef(chatId);

	React.useEffect(() => {
		if (previousChatIdRef.current !== chatId) {
			previousChatIdRef.current = chatId;
			appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
			setMessages(sessionPersistedMessages);
			return;
		}

		if (isChatRequestPending) {
			return;
		}

		setMessages((currentMessages) => {
			const currentMessagesSeedKey = getUIMessageSeedKey(currentMessages);
			const nextPersistedMessages = activeAssistantMessageId
				? removeChatMessageById(
						sessionPersistedMessages,
						activeAssistantMessageId,
					)
				: sessionPersistedMessages;
			const shouldUsePersistedMessages =
				currentMessages.length === 0 ||
				currentMessagesSeedKey === appliedPersistedMessagesSeedKeyRef.current ||
				(!activeRun && nextPersistedMessages.length > 0);

			if (shouldUsePersistedMessages) {
				appliedPersistedMessagesSeedKeyRef.current = persistedMessagesSeedKey;
				return nextPersistedMessages;
			}

			return normalizeChatMessages(currentMessages);
		});
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		activeRun,
		activeAssistantMessageId,
		chatId,
		isChatRequestPending,
		sessionPersistedMessages,
		persistedMessagesSeedKey,
		setMessages,
	]);

	const steerMessageIds = React.useMemo(
		() => [
			...(activeAssistantMessageId ? [activeAssistantMessageId] : []),
			...(displayActiveRun?.assistantMessageId
				? [displayActiveRun.assistantMessageId]
				: []),
		],
		[activeAssistantMessageId, displayActiveRun?.assistantMessageId],
	);
	const queuedFollowUpControls = useQueuedFollowUps({
		session: queueSession,
		queueActiveRun,
		chatId,
		contextLabel,
		error,
		isChatRequestPending,
		latestRequestBodyRef,
		localMessageIds,
		onEditMessage: onEditQueuedMessage,
		sendMessage,
		steerMessageIds,
		workspaceId,
	});
	const isPersistedChatStreaming = Boolean(displayActiveRun);
	const isChatUiPending =
		isChatRequestPending || isPersistedChatStreaming || isExternallyBlocked;
	const stopCurrentStream = React.useCallback(
		async ({ interruptActiveRun = false } = {}) => {
			await stopChatInteraction({
				chatId,
				contextLabel,
				hasDisplayActiveRun: Boolean(displayActiveRun),
				interruptActiveRun,
				stopActiveRun: stopActiveChatStream,
				stopExternalRun,
				stopLocalStream: stop,
				workspaceId,
			});
		},
		[
			chatId,
			contextLabel,
			displayActiveRun,
			stop,
			stopExternalRun,
			workspaceId,
		],
	);
	const handleStop = React.useCallback(() => {
		void stopCurrentStream().catch((error) => {
			logError({
				event: "client.error",
				error,
				message: `Failed to stop ${contextLabel} stream`,
			});
			toast.error(
				error instanceof Error
					? error.message
					: `Failed to stop ${contextLabel} stream`,
			);
		});
	}, [contextLabel, stopCurrentStream]);
	const submitTurn = React.useCallback(
		(input: SubmitRendererChatTurnInput) =>
			runTurnAdmission((admission) =>
				runPreparedRequest(async () => {
					let optimisticMessageId: string | null = null;
					try {
						return await submitChatTurn({
							...input,
							chatId,
							currentRunAdmission:
								admission.status === "current_run"
									? {
											admitQueuedMessage,
											beginDirectSubmission: admission.beginDirectSubmission,
											completeQueuedAdmission:
												admission.completeQueuedAdmission,
											status: "current_run",
										}
									: admission,
							displayActiveRun,
							enqueueQueuedMessage,
							onOptimisticMessage: (message) => {
								optimisticMessageId = message.id;
								commitOptimisticMessage({ message });
							},
							onQueuedMessageSaved: queuedFollowUpControls.onQueuedMessageSaved,
							queueActiveRun,
							sendMessage,
							workspaceId,
						});
					} catch (error) {
						if (optimisticMessageId) {
							rollbackOptimisticMessage(optimisticMessageId);
						}
						throw error;
					}
				}),
			),
		[
			admitQueuedMessage,
			chatId,
			commitOptimisticMessage,
			displayActiveRun,
			enqueueQueuedMessage,
			queueActiveRun,
			queuedFollowUpControls.onQueuedMessageSaved,
			rollbackOptimisticMessage,
			runPreparedRequest,
			runTurnAdmission,
			sendMessage,
			workspaceId,
		],
	);
	const submitUserQuestionAnswer = React.useCallback(
		({ answer, onRequestPrepared }: SubmitUserQuestionAnswerInput) => {
			if (
				pendingHumanDecision?.type !== "user_question" ||
				isPreparingRequest
			) {
				return Promise.resolve(false);
			}
			if (!displayActiveRun) {
				return Promise.reject(
					new Error("Answering a question requires an active assistant run."),
				);
			}

			return runPreparedRequest(async () => {
				const requestBody = await buildCurrentRequestBody();
				latestRequestBodyRef.current = requestBody;
				onRequestPrepared?.(requestBody);
				const pendingMessages = prepareRendererUserQuestionMessages({
					decision: pendingHumanDecision,
					messages: displayMessages,
				});
				clearError();
				pendingUserQuestionRollbackRef.current = {
					assistantMessageId: pendingHumanDecision.assistantMessageId,
					chatId,
					messages: pendingMessages,
					toolCallId: pendingHumanDecision.toolCallId,
				};
				setMessages(pendingMessages);
				try {
					await addToolOutput({
						tool: HOSTED_REQUEST_USER_INPUT_TOOL_NAME,
						toolCallId: pendingHumanDecision.toolCallId,
						output: { answer },
					});
					await sendMessage(undefined, {
						body: {
							...requestBody,
							continueRunId: displayActiveRun._id,
						},
					});
					return true;
				} catch (error) {
					pendingUserQuestionRollbackRef.current = null;
					setMessages(pendingMessages);
					throw error;
				}
			});
		},
		[
			addToolOutput,
			buildCurrentRequestBody,
			clearError,
			chatId,
			displayActiveRun,
			displayMessages,
			isPreparingRequest,
			pendingHumanDecision,
			runPreparedRequest,
			sendMessage,
			setMessages,
			latestRequestBodyRef,
		],
	);
	const updateQueuedTurn = React.useCallback(
		(input: UpdateQueuedRendererChatTurnInput) =>
			runPreparedRequest(async () => {
				const editDraft = queuedFollowUpControls.editDraft;
				if (!editDraft || !workspaceId) {
					throw new Error("Cannot edit queued message without a workspace.");
				}

				const requestBody = await input.buildRequestBody();
				const updatedQueuedMessage = await updateQueuedMessage({
					workspaceId,
					chatId,
					queuedMessageId: editDraft._id,
					claimVersion: editDraft.claimVersion,
					message: toQueuedUserMessageInput({
						files: getReadyFileParts(input.attachedFiles),
						messageId: editDraft.messageId,
						metadata: input.metadata,
						requestBody,
						text: input.text,
					}),
				});
				if (
					!queuedFollowUpControls.finishQueuedMessageEdit(updatedQueuedMessage)
				) {
					return false;
				}

				latestRequestBodyRef.current = requestBody;
				input.onRequestPrepared?.({
					localCapabilitySession: requestBody.localCapabilitySession,
					requestBody,
				});
				return true;
			}),
		[
			chatId,
			queuedFollowUpControls.editDraft,
			queuedFollowUpControls.finishQueuedMessageEdit,
			runPreparedRequest,
			updateQueuedMessage,
			workspaceId,
			latestRequestBodyRef,
		],
	);
	const submitToolApproval = React.useCallback(
		({
			approved,
			onRequestPrepared,
		}: {
			approved: boolean;
			onRequestPrepared?: (requestBody: ChatRequestContext) => void;
		}) => {
			if (
				pendingHumanDecision?.type !== "tool_approval" ||
				isPreparingRequest
			) {
				return Promise.resolve(false);
			}
			if (!displayActiveRun) {
				return Promise.reject(
					new Error("Tool approval requires an active assistant run."),
				);
			}

			return runPreparedRequest(async () => {
				const requestBody = await buildCurrentRequestBody();
				latestRequestBodyRef.current = requestBody;
				onRequestPrepared?.(requestBody);
				await addToolApprovalResponse({
					id: pendingHumanDecision.approvalId,
					approved,
					reason: approved ? "Approved by user." : "Denied by user.",
					options: {
						body: {
							...requestBody,
							continueRunId: displayActiveRun._id,
						},
					},
				});
				return true;
			});
		},
		[
			addToolApprovalResponse,
			buildCurrentRequestBody,
			displayActiveRun,
			isPreparingRequest,
			pendingHumanDecision,
			runPreparedRequest,
			latestRequestBodyRef,
		],
	);
	const submitHumanDecision = React.useCallback(
		({ onRequestPrepared, response }: SubmitHumanDecisionInput) =>
			response.type === "user_question"
				? submitUserQuestionAnswer({
						answer: response.answer,
						onRequestPrepared,
					})
				: submitToolApproval({
						approved: response.approved,
						onRequestPrepared,
					}),
		[submitToolApproval, submitUserQuestionAnswer],
	);
	const deleteMessage = React.useCallback(
		async (messageId: string) => {
			if (isChatUiPending) {
				await stopCurrentStream();
			}

			setPendingBranchMessageId(messageId);
			branchMessagesFrom({ messageId });
			if (!workspaceId) {
				return;
			}

			try {
				await branchFromMessage({ workspaceId, chatId, messageId });
			} catch (error) {
				setPendingBranchMessageId(null);
				throw error;
			}
		},
		[
			branchFromMessage,
			branchMessagesFrom,
			chatId,
			isChatUiPending,
			stopCurrentStream,
			workspaceId,
		],
	);
	const regenerateTurn = React.useCallback(
		async (input: RegenerateRendererChatTurnInput) => {
			if (isChatUiPending) {
				await stopCurrentStream();
			}

			await runPreparedRequest(async () => {
				const requestBody = await buildCurrentRequestBody();
				latestRequestBodyRef.current = requestBody;
				input.onRequestPrepared(requestBody);
				await Promise.resolve(
					regenerate({
						body: requestBody,
						messageId: input.assistantMessageId,
					}),
				);
			});
		},
		[
			buildCurrentRequestBody,
			isChatUiPending,
			regenerate,
			runPreparedRequest,
			stopCurrentStream,
			latestRequestBodyRef,
		],
	);
	React.useEffect(() => {
		const recoverPendingLocalCapabilityCalls = async () => {
			try {
				await recoverPendingLocalCapabilityToolCalls({
					buildRequestBody: buildContinuationRequestBody,
					claimedRecoveryKeys: recoveredLocalToolCallsRef.current,
					executeToolCall: ({ localCapabilitySession, toolCall }) =>
						executeDesktopLocalToolCall({
							fetchImpl: fetch,
							fileStorage: localFileStorage,
							localCapabilitySession,
							toolCall,
						}),
					onExecutionError: (error) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to recover a local capability tool call",
						});
					},
					run: attachableActiveRun,
					setLatestRequestBody: (requestBody) => {
						latestRequestBodyRef.current = requestBody;
					},
					submitToolOutput: addToolOutput,
				});
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to continue a recovered local capability run",
				});
			}
		};

		void recoverPendingLocalCapabilityCalls();
	}, [
		addToolOutput,
		attachableActiveRun,
		buildContinuationRequestBody,
		localFileStorage,
		latestRequestBodyRef,
	]);

	return {
		canStop: isChatUiPending,
		deleteMessage,
		displayActiveRun,
		displayMessages,
		editDraft: queuedFollowUpControls.editDraft,
		error,
		handleStop,
		hasLocallyCompletedAssistantMessage,
		isChatRequestPending,
		isPreparingRequest,
		isQueuedMessageEditCurrent:
			queuedFollowUpControls.isQueuedMessageEditCurrent,
		isResumingQueuedFollowUps: queuedFollowUpControls.isResumingQueuedFollowUps,
		onQueuedFollowUpsReorder: queuedFollowUpControls.onQueuedFollowUpsReorder,
		onQueuedFollowUpsResume: queuedFollowUpControls.onQueuedFollowUpsResume,
		pendingHumanDecision,
		queuedFollowUps: queuedFollowUpControls.queuedFollowUps,
		runPlan: runPlan ?? null,
		regenerateTurn,
		restoreEditedQueuedMessage:
			queuedFollowUpControls.restoreEditedQueuedMessage,
		setMessages,
		status,
		streamingMessageIds,
		submitHumanDecision,
		submitTurn,
		updateQueuedTurn,
	};
};
