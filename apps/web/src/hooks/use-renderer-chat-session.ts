import { useChat } from "@ai-sdk/react";
import {
	getMatchingPendingHostedHumanDecision,
	type HostedHumanDecisionResponse,
} from "@workspace/ai/hosted-human-decision";
import { HOSTED_REQUEST_USER_INPUT_TOOL_NAME } from "@workspace/ai/hosted-user-question";
import type { ChatAddToolOutputFunction, UIMessage } from "ai";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
// Optimistic insertion must commit before submit continues into DOM measurement.
// react-doctor-disable-next-line react-doctor/no-flush-sync -- the interaction owner guarantees the optimistic message is visible before submit continues.
import { flushSync } from "react-dom";
import { toast } from "sonner";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import { stopActiveChatStream } from "@/lib/chat-active-stream";
import { stopChatInteraction } from "@/lib/chat-interaction-session";
import {
	appendLocalOptimisticChatMessages,
	normalizeChatMessages,
} from "@/lib/chat-message-state";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { getUIMessageSeedKey } from "@/lib/chat-snapshot";
import { CHAT_STREAM_UI_THROTTLE_MS } from "@/lib/chat-streaming-performance";
import {
	removeChatMessageById,
	submitChatTurn,
} from "@/lib/chat-submit-session";
import { applyPendingBranchReplacement } from "@/lib/chat-thread";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import { logError } from "@/lib/logger";
import {
	mergeRendererChatSessionMessages,
	prepareRendererUserQuestionMessages,
	resolveRendererChatRunState,
	shouldAutomaticallyContinueRendererChat,
} from "@/lib/renderer-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useChatInteractionSession } from "./use-chat-interaction-session";
import { useLocalFileStorage } from "./use-local-file-storage";
import { useQueuedChatDrain } from "./use-queued-chat-drain";
import { useQueuedFollowUpControls } from "./use-queued-follow-up-controls";
import { useResumeActiveChatRun } from "./use-resume-active-chat-run";
import { useWorkspaceChatTransport } from "./use-workspace-chat-transport";

const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>();

type SubmitRendererChatTurnInput = Omit<
	Parameters<typeof submitChatTurn>[0],
	| "chatId"
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
	"buildRequestBody" | "metadata" | "text"
> & {
	onRequestPrepared?: SubmitRendererChatTurnInput["onRequestPrepared"];
};

type SubmitUserQuestionAnswerInput = Pick<
	SubmitRendererChatTurnInput,
	"buildRequestBody"
> & {
	answer: string;
	onRequestPrepared?: (requestBody: ChatRequestContext) => void;
};

type SubmitHumanDecisionInput = Pick<
	SubmitRendererChatTurnInput,
	"buildRequestBody"
> & {
	response: HostedHumanDecisionResponse;
	onRequestPrepared?: (requestBody: ChatRequestContext) => void;
};

type RegenerateRendererChatTurnInput = Pick<
	SubmitRendererChatTurnInput,
	"buildRequestBody"
> & {
	assistantMessageId: string;
	onRequestPrepared: (
		requestBody: Awaited<
			ReturnType<SubmitRendererChatTurnInput["buildRequestBody"]>
		>,
	) => void;
};

export const useRendererChatSession = ({
	activeRun,
	chatId,
	contextLabel,
	isExternallyBlocked = false,
	onEditQueuedMessage,
	persistedMessages,
	resumeEnabled = true,
	stopExternalRun,
	workspaceId,
}: {
	activeRun: AttachableAssistantRunQueryResult;
	chatId: string;
	contextLabel: string;
	isExternallyBlocked?: boolean;
	onEditQueuedMessage: (message: QueuedFollowUpMessage) => void;
	persistedMessages: UIMessage[];
	resumeEnabled?: boolean;
	stopExternalRun?: () => Promise<boolean>;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const attachableActiveRun =
		activeRun && activeRun.status !== "stopping" ? activeRun : null;
	const runPlan = useQuery(
		api.assistantRunActivity.getActivePlan,
		attachableActiveRun ? { runId: attachableActiveRun._id } : "skip",
	);
	const branchFromMessage = useMutation(api.chatBranches.branchFromMessage);
	const enqueueQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
	);
	const updateQueuedMessage = useMutation(
		api.assistantQueuedMessages.updateQueued,
	);
	const [pendingBranchMessageId, setPendingBranchMessageId] = React.useState<
		string | null
	>(null);
	const activePendingBranchMessageId =
		pendingBranchMessageId &&
		persistedMessages.some((message) => message.id === pendingBranchMessageId)
			? pendingBranchMessageId
			: null;
	const sessionPersistedMessages = React.useMemo(
		() =>
			applyPendingBranchReplacement(
				persistedMessages,
				activePendingBranchMessageId,
			),
		[activePendingBranchMessageId, persistedMessages],
	);
	const transport = useWorkspaceChatTransport(workspaceId);
	const localFileStorage = useLocalFileStorage();
	const latestRequestBodyRef = React.useRef<ChatRequestContext | null>(null);
	const pendingUserQuestionRollbackRef = React.useRef<{
		assistantMessageId: string;
		chatId: string;
		messages: UIMessage[];
		toolCallId: string;
	} | null>(null);
	const addToolOutputRef =
		React.useRef<ChatAddToolOutputFunction<UIMessage> | null>(null);
	const [activeSteerHandoffStreamingMessageIds, setActiveSteerHandoffIds] =
		React.useState<ReadonlySet<string>>(() => new Set());
	const handleToolCall = React.useMemo(
		() =>
			createDesktopLocalToolCallHandler({
				addToolOutputRef,
				fetchImpl: fetch,
				fileStorage: localFileStorage,
				latestRequestBodyRef,
			}),
		[localFileStorage],
	);
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
		id: chatId,
		throttle: CHAT_STREAM_UI_THROTTLE_MS,
		messages: sessionPersistedMessages,
		transport,
		onToolCall: handleToolCall,
		sendAutomaticallyWhen: shouldAutomaticallyContinueRendererChat,
	});
	const {
		commitOptimisticMessage,
		isPreparingRequest,
		localOptimisticMessages,
		rollbackOptimisticMessage,
		runPreparedRequest,
		branchMessagesFrom,
	} = useChatInteractionSession({ chatId, setMessages });
	React.useEffect(() => {
		addToolOutputRef.current = addToolOutput;

		return () => {
			if (addToolOutputRef.current === addToolOutput) {
				addToolOutputRef.current = null;
			}
		};
	}, [addToolOutput]);

	const controllerMessages = React.useMemo(
		() => normalizeChatMessages(messages),
		[messages],
	);
	const isAiRequestPending = status === "submitted" || status === "streaming";
	const isChatRequestPending = isAiRequestPending || isPreparingRequest;
	const {
		activeAssistantMessageId,
		displayActiveRun,
		hasLocallyCompletedAssistantMessage,
	} = React.useMemo(
		() =>
			resolveRendererChatRunState({
				activeRun: attachableActiveRun,
				controllerMessages,
				isAiRequestPending,
				persistedMessages: sessionPersistedMessages,
			}),
		[
			attachableActiveRun,
			controllerMessages,
			isAiRequestPending,
			sessionPersistedMessages,
		],
	);
	const steerHandoffStreamingMessageIds =
		displayActiveRun || isChatRequestPending
			? activeSteerHandoffStreamingMessageIds
			: EMPTY_STREAMING_MESSAGE_IDS;
	React.useEffect(() => {
		const rollback = pendingUserQuestionRollbackRef.current;
		if (!error || !rollback) {
			return;
		}
		if (rollback.chatId !== chatId) {
			pendingUserQuestionRollbackRef.current = null;
			return;
		}

		pendingUserQuestionRollbackRef.current = null;
		setMessages(rollback.messages);
	}, [chatId, error, setMessages]);
	React.useEffect(() => {
		const rollback = pendingUserQuestionRollbackRef.current;
		if (!rollback) {
			return;
		}
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

	const mergedDisplayMessages = React.useMemo(
		() =>
			mergeRendererChatSessionMessages({
				activeAssistantMessageId,
				controllerMessages,
				displayActiveRun,
				persistedMessages: sessionPersistedMessages,
			}),
		[
			activeAssistantMessageId,
			controllerMessages,
			displayActiveRun,
			sessionPersistedMessages,
		],
	);
	const displayMessages = React.useMemo(
		() =>
			appendLocalOptimisticChatMessages({
				displayMessages: mergedDisplayMessages,
				localOptimisticMessages:
					localOptimisticMessages?.chatId === chatId
						? localOptimisticMessages.messages
						: [],
				resolvedMessages: sessionPersistedMessages,
			}),
		[
			chatId,
			localOptimisticMessages,
			mergedDisplayMessages,
			sessionPersistedMessages,
		],
	);
	const pendingHumanDecision = React.useMemo(
		() =>
			getMatchingPendingHostedHumanDecision({
				messages: displayMessages,
				pendingDecision: displayActiveRun?.pendingDecision,
			}),
		[displayActiveRun?.pendingDecision, displayMessages],
	);
	const localMessageIds = React.useMemo(
		() =>
			new Set([
				...controllerMessages.map((message) => message.id),
				...(localOptimisticMessages?.chatId === chatId
					? localOptimisticMessages.messages.map((message) => message.id)
					: []),
			]),
		[chatId, controllerMessages, localOptimisticMessages],
	);
	const streamingMessageIds = React.useMemo(
		() =>
			new Set([
				...steerHandoffStreamingMessageIds,
				...(displayActiveRun?.interruptedAssistantMessageIds ?? []),
			]),
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			displayActiveRun?.interruptedAssistantMessageIds,
			steerHandoffStreamingMessageIds,
		],
	);

	const { queuedMessages, setQueuedMessages } = useQueuedChatDrain({
		activeRun: displayActiveRun,
		chatId,
		contextLabel,
		isBlocked: isChatRequestPending || isExternallyBlocked,
		latestRequestBodyRef,
		localMessageIds,
		sendMessage,
		workspaceId,
	});
	const queuedFollowUpControls = useQueuedFollowUpControls({
		activeRun: displayActiveRun,
		chatId,
		contextLabel,
		latestRequestBodyRef,
		localMessageIds,
		onEditMessage: onEditQueuedMessage,
		onSteerStart: () => {
			const handoffMessageIds = [
				...(activeAssistantMessageId ? [activeAssistantMessageId] : []),
				...(displayActiveRun?.assistantMessageId
					? [displayActiveRun.assistantMessageId]
					: []),
			];
			if (handoffMessageIds.length === 0) {
				return undefined;
			}

			setActiveSteerHandoffIds((messageIds) => {
				const nextMessageIds = new Set(messageIds);
				for (const messageId of handoffMessageIds) {
					nextMessageIds.add(messageId);
				}
				return nextMessageIds;
			});

			return () =>
				setActiveSteerHandoffIds((messageIds) => {
					const nextMessageIds = new Set(messageIds);
					for (const messageId of handoffMessageIds) {
						nextMessageIds.delete(messageId);
					}
					return nextMessageIds;
				});
		},
		queuedMessages,
		sendMessage,
		setQueuedMessages,
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
		const stopPromise = queuedMessages[0]
			? queuedFollowUpControls.sendQueuedFollowUpNow()
			: stopCurrentStream();

		void stopPromise.catch((error) => {
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
	}, [
		contextLabel,
		queuedFollowUpControls.sendQueuedFollowUpNow,
		queuedMessages,
		stopCurrentStream,
	]);
	const submitTurn = React.useCallback(
		(input: SubmitRendererChatTurnInput) =>
			runPreparedRequest(async () => {
				let optimisticMessageId: string | null = null;
				try {
					return await submitChatTurn({
						...input,
						chatId,
						displayActiveRun,
						enqueueQueuedMessage,
						onOptimisticMessage: (message) => {
							optimisticMessageId = message.id;
							flushSync(() => {
								commitOptimisticMessage({ message });
							});
						},
						onQueuedMessageSaved: ({
							optimisticMessageId: savedOptimisticMessageId,
							queuedMessage,
						}) => {
							setQueuedMessages((currentMessages) =>
								currentMessages.map((message) =>
									message._id === savedOptimisticMessageId
										? queuedMessage
										: message,
								),
							);
						},
						queueActiveRun:
							displayActiveRun ?? (isAiRequestPending ? activeRun : null),
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
		[
			activeRun,
			chatId,
			commitOptimisticMessage,
			displayActiveRun,
			enqueueQueuedMessage,
			isAiRequestPending,
			rollbackOptimisticMessage,
			runPreparedRequest,
			sendMessage,
			setQueuedMessages,
			workspaceId,
		],
	);
	const submitUserQuestionAnswer = React.useCallback(
		({
			answer,
			buildRequestBody,
			onRequestPrepared,
		}: SubmitUserQuestionAnswerInput) => {
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
				const requestBody = await buildRequestBody();
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
			clearError,
			chatId,
			displayActiveRun,
			displayMessages,
			isPreparingRequest,
			pendingHumanDecision,
			runPreparedRequest,
			sendMessage,
			setMessages,
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
					queuedMessageId: editDraft.message._id,
					message: toQueuedUserMessageInput({
						messageId: editDraft.message.messageId,
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
					localFolders: requestBody.localFolders,
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
		],
	);
	const submitToolApproval = React.useCallback(
		({
			approved,
			buildRequestBody,
			onRequestPrepared,
		}: {
			approved: boolean;
			buildRequestBody: SubmitRendererChatTurnInput["buildRequestBody"];
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
				const requestBody = await buildRequestBody();
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
			displayActiveRun,
			isPreparingRequest,
			pendingHumanDecision,
			runPreparedRequest,
		],
	);
	const submitHumanDecision = React.useCallback(
		({
			buildRequestBody,
			onRequestPrepared,
			response,
		}: SubmitHumanDecisionInput) =>
			response.type === "user_question"
				? submitUserQuestionAnswer({
						answer: response.answer,
						buildRequestBody,
						onRequestPrepared,
					})
				: submitToolApproval({
						approved: response.approved,
						buildRequestBody,
						onRequestPrepared,
					}),
		[submitToolApproval, submitUserQuestionAnswer],
	);
	const deleteMessage = React.useCallback(
		async (messageId: string) => {
			if (isChatUiPending) {
				handleStop();
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
			handleStop,
			isChatUiPending,
			workspaceId,
		],
	);
	const regenerateTurn = React.useCallback(
		async (input: RegenerateRendererChatTurnInput) => {
			if (isChatUiPending) {
				await stopCurrentStream();
			}

			await runPreparedRequest(async () => {
				const requestBody = await input.buildRequestBody();
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
		[isChatUiPending, regenerate, runPreparedRequest, stopCurrentStream],
	);

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
		onQueuedFollowUpsReorder: queuedFollowUpControls.onQueuedFollowUpsReorder,
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
