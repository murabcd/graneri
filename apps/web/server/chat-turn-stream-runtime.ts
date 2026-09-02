import type { ServerResponse } from "node:http";
import {
	type ChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "@workspace/ai/chat-latency-logger";
import {
	buildHostedSteeredGenerationTranscript,
	toHostedStoredMessage,
} from "@workspace/ai/hosted-chat-runtime";
import {
	createHostedActiveStreamKey,
	createHostedAssistantRunFinalizer,
	createHostedChatRunResponseStream,
	type HostedActiveStreamSession,
	startHostedChatRun,
} from "@workspace/ai/hosted-chat-turn";
import type { UIMessageChunk } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
	acceptHostedChatTurn,
	createHostedChatTurnPersistence,
	type HostedChatTurnAcceptancePolicy,
	type HostedChatTurnAcceptedInput,
	type HostedChatTurnPreparedPersistence,
} from "./chat-accepted-turn-transaction.js";
import type { ServerAssistantRunContext } from "./chat-assistant-run-input.js";
import type { ChatRequestBody } from "./chat-handler-types.js";
import { createHostedChatTurnRouteErrorResponder } from "./chat-turn-route-errors.js";
import type { SendJson } from "./http-utils.js";
import { recordServerError, type ServerWideEvent } from "./server-logger.js";
import { pipeUiMessageStreamToServerResponse } from "./ui-message-response-stream.js";

export type HostedChatTurnStreamRuntimeResult =
	| {
			activeStreamSession: HostedActiveStreamSession<
				Id<"assistantRuns">,
				Id<"assistantQueuedMessages">
			> | null;
			assistantMessageId: string;
			assistantRunId: Id<"assistantRuns">;
			ok: true;
	  }
	| {
			activeStreamSession: HostedActiveStreamSession<
				Id<"assistantRuns">,
				Id<"assistantQueuedMessages">
			> | null;
			claimDisposition: "hold" | "release";
			ok: false;
	  };

export const pipeHostedActiveStreamSessionToResponse = ({
	activeStreamSession,
	response,
}: {
	activeStreamSession: HostedActiveStreamSession;
	response: ServerResponse;
}) => {
	void pipeUiMessageStreamToServerResponse({
		response,
		stream: activeStreamSession.subscribe<UIMessageChunk>(),
	});
};

export const interruptHostedChatRun = async ({
	activeStreamSessions,
	chatId,
	pendingInput = [],
	runId,
	assistantMessageId,
	stopActiveStream,
	workspaceId,
}: {
	activeStreamSessions: Map<
		string,
		HostedActiveStreamSession<
			Id<"assistantRuns">,
			Id<"assistantQueuedMessages">
		>
	>;
	chatId: string;
	pendingInput?: readonly unknown[];
	runId: Id<"assistantRuns">;
	assistantMessageId: string;
	stopActiveStream: (args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
		assistantMessageId: string;
		steeredGenerationBoundary?: {
			orderedMessageIds: string[];
			steerAcceptances: Array<{
				queuedMessageId: Id<"assistantQueuedMessages">;
				claimVersion: number;
				messageId: string;
			}>;
			assistantMessages: ReturnType<typeof toHostedStoredMessage>[];
		};
	}) => Promise<unknown>;
	workspaceId: Id<"workspaces">;
}) => {
	const streamKey = createHostedActiveStreamKey({ workspaceId, chatId });
	const activeSession = activeStreamSessions.get(streamKey);
	const isExpectedSession =
		activeSession?.persister.runId === runId &&
		activeSession.persister.messageId === assistantMessageId;
	let steeredGenerationBoundary:
		| {
				orderedMessageIds: string[];
				steerAcceptances: Array<{
					queuedMessageId: Id<"assistantQueuedMessages">;
					claimVersion: number;
					messageId: string;
				}>;
				assistantMessages: ReturnType<typeof toHostedStoredMessage>[];
		  }
		| undefined;
	let drainedPendingInput: unknown[] = [];
	if (pendingInput.length > 0 && isExpectedSession) {
		activeSession?.turnInput.extendSteerInput([...pendingInput]);
	}
	if (isExpectedSession) {
		activeSession.beginDurableStop();
		await activeSession.waitForSteeredUserMessageReservations();
		activeSession.abort("stopped");
		await activeSession.persister.flush?.();
		const boundary = activeSession.prepareDurableStopBoundary();
		const acceptedMessageIds = new Set(
			boundary.steerAcceptances.map((acceptance) => acceptance.messageId),
		);
		const acceptedConsumed: typeof boundary.consumed = [];
		for (const batch of boundary.consumed) {
			const input = batch.input.filter((message) =>
				acceptedMessageIds.has(message.id),
			);
			if (input.length > 0) {
				acceptedConsumed.push({ ...batch, input });
			}
		}
		const acceptedBoundary = {
			consumed: acceptedConsumed,
			pending: boundary.pending.filter((message) =>
				acceptedMessageIds.has(message.id),
			),
		};
		drainedPendingInput = [
			...boundary.consumed.flatMap((batch) =>
				batch.input.filter((message) => !acceptedMessageIds.has(message.id)),
			),
			...boundary.pending.filter(
				(message) => !acceptedMessageIds.has(message.id),
			),
			...boundary.deferredInput,
		];
		const responseMessage = activeSession.persister.responseMessage;
		if (
			responseMessage &&
			boundary.steerAcceptances.length > 0 &&
			(acceptedBoundary.consumed.length > 0 ||
				acceptedBoundary.pending.length > 0)
		) {
			const transcript = buildHostedSteeredGenerationTranscript({
				...acceptedBoundary,
				responseMessage,
			});
			const assistantMessages: ReturnType<typeof toHostedStoredMessage>[] = [];
			for (const message of transcript) {
				if (message.role !== "assistant") {
					continue;
				}
				const assistantMessage = {
					...toHostedStoredMessage(message),
					createdAt: boundary.preparedAt,
				};
				if (assistantMessage.text.trim().length > 0) {
					assistantMessages.push(assistantMessage);
				}
			}
			const assistantMessageIds = new Set(
				assistantMessages.map((message) => message.id),
			);
			const orderedMessageIds: string[] = [];
			for (const message of transcript) {
				if (message.role === "user" || assistantMessageIds.has(message.id)) {
					orderedMessageIds.push(message.id);
				}
			}
			steeredGenerationBoundary = {
				orderedMessageIds,
				steerAcceptances: boundary.steerAcceptances,
				assistantMessages,
			};
		}
	}

	await stopActiveStream({
		workspaceId,
		chatId,
		runId,
		assistantMessageId,
		...(steeredGenerationBoundary && { steeredGenerationBoundary }),
	});
	if (isExpectedSession) {
		activeSession.commitDurableStop();
	}

	return drainedPendingInput;
};

export type HostedChatTurnRouteEnvironment = {
	activeStreamSessions: Map<
		string,
		HostedActiveStreamSession<
			Id<"assistantRuns">,
			Id<"assistantQueuedMessages">
		>
	>;
	client: ConvexHttpClient;
	emitEvent: (level: "error" | "info") => void;
	logLatency: ChatLatencyLogger;
	onSteerAccepted: (runId: Id<"assistantRuns"> | null) => void;
	response: ServerResponse;
	sendJson: SendJson;
	wideEvent: ServerWideEvent;
};

export type HostedChatTurnPreparedRun = HostedChatTurnPreparedPersistence &
	Pick<
		ServerAssistantRunContext,
		"agent" | "appConnections" | "finalizedToolSet"
	>;

export type HostedChatTurnExecutionPolicy = HostedChatTurnAcceptancePolicy & {
	localCapabilitySession: NonNullable<
		ChatRequestBody["localCapabilitySession"]
	> | null;
	safetyIdentifier: string;
};

export const runHostedChatTurnStreamRuntime = async ({
	acceptedInput,
	environment,
	policy,
	preparedRun,
}: {
	acceptedInput: HostedChatTurnAcceptedInput;
	environment: HostedChatTurnRouteEnvironment;
	policy: HostedChatTurnExecutionPolicy;
	preparedRun: HostedChatTurnPreparedRun;
}): Promise<HostedChatTurnStreamRuntimeResult> => {
	const { attachableRun, turnController, turnIntent } = acceptedInput;
	const continueRunId =
		turnIntent.type === "steer"
			? turnIntent.runId
			: turnIntent.type === "direct"
				? turnIntent.continueRunId
				: null;
	const {
		activeStreamSessions,
		client: convexClient,
		emitEvent: emitWideEvent,
		logLatency,
		onSteerAccepted: setAcceptedSteerTurnId,
		response,
		sendJson,
		wideEvent,
	} = environment;
	const {
		chatId,
		localCapabilitySession,
		noteId,
		safetyIdentifier,
		settings,
		supersedeActiveRun,
		trigger,
		workspaceId,
	} = policy;
	const { model, reasoningEffort, serviceTier } = settings;
	const {
		agent,
		appConnections,
		chatMessages,
		finalizedToolSet,
		instructions,
		lastUserMessage,
		localFolderRoots,
		shouldGenerateChatTitle,
	} = preparedRun;
	const turnRouteErrors = createHostedChatTurnRouteErrorResponder({
		continueRunId,
		emitWideEvent,
		response,
		sendJson,
		turnController,
		wideEvent,
	});
	const releaseClaimedQueuedMessage = async () =>
		await turnRouteErrors.releaseClaimedQueuedMessage("queue_claim_release");
	const rejectUnavailableSteerSession = async () => {
		if (await releaseClaimedQueuedMessage()) {
			turnRouteErrors.send({
				eventErrorCode: "steer_active_stream_unavailable",
				payload: {
					error:
						"The active assistant stream finished before the steer input could attach.",
				},
				statusCode: 409,
			});
		}
		return {
			activeStreamSession: null,
			claimDisposition: "release" as const,
			ok: false as const,
		};
	};
	let reservedSteerSession: HostedActiveStreamSession<
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	> | null = null;
	let steerReservation: ReturnType<
		HostedActiveStreamSession<
			Id<"assistantRuns">,
			Id<"assistantQueuedMessages">
		>["reserveSteeredUserMessageAcceptance"]
	> = null;
	if (turnIntent.type === "steer" && attachableRun?.producer === "web") {
		const streamKey = createHostedActiveStreamKey({ workspaceId, chatId });
		const activeStreamSession = activeStreamSessions.get(streamKey);
		if (
			!activeStreamSession ||
			activeStreamSession.persister.runId !== attachableRun._id ||
			activeStreamSession.persister.messageId !==
				attachableRun.assistantMessageId
		) {
			return await rejectUnavailableSteerSession();
		}
		const reservation =
			activeStreamSession.reserveSteeredUserMessageAcceptance();
		if (!reservation) {
			return await rejectUnavailableSteerSession();
		}
		reservedSteerSession = activeStreamSession;
		steerReservation = reservation;
	}

	let acceptance: Awaited<ReturnType<typeof acceptHostedChatTurn>>;
	const claimedSteerLease =
		turnIntent.type === "steer" ? acceptedInput.queuedInput.claimedLease : null;
	try {
		acceptance = await acceptHostedChatTurn({
			acceptedInput,
			releaseClaimedQueuedMessage,
			onSteerAccepted: setAcceptedSteerTurnId,
			onUserMessagePersistenceCompleted: (attempted) => {
				logLatency("convex.user_message_saved", { attempted });
			},
			persistence: createHostedChatTurnPersistence(convexClient),
			policy,
			preparedRun,
		});
	} catch (error) {
		steerReservation?.release();
		throw error;
	}
	if (!acceptance.ok) {
		steerReservation?.release();
		turnRouteErrors.sendAcceptanceFailure({
			failure: acceptance.failure,
			lastUserMessageId: lastUserMessage?.id,
		});
		return {
			activeStreamSession: null,
			claimDisposition:
				acceptance.failure.type === "queued_acceptance_status_lookup"
					? "hold"
					: "release",
			ok: false,
		};
	}

	const { assistantMessageId, pendingQueuedAcceptanceHeaders, producer } =
		acceptance.acceptedTurn;
	if (turnIntent.type === "steer" && producer.type === "web" && attachableRun) {
		const attachedToActiveStream =
			reservedSteerSession &&
			attachableRun &&
			lastUserMessage &&
			reservedSteerSession.persister.runId === attachableRun._id &&
			reservedSteerSession.persister.messageId === assistantMessageId &&
			steerReservation?.accept(
				lastUserMessage,
				claimedSteerLease
					? {
							queuedMessageId: claimedSteerLease.queuedMessageId,
							claimVersion: claimedSteerLease.claimVersion,
							messageId: lastUserMessage.id,
						}
					: undefined,
			);
		steerReservation?.release();
		if (!attachedToActiveStream) {
			logLatency("ai.steer_active_stream_attach_closed");
		}
		wideEvent.assistant_run_id = attachableRun._id;
		wideEvent.assistant_message_id = assistantMessageId;
		wideEvent.outcome = "success";
		wideEvent.status_code = 200;
		if (pendingQueuedAcceptanceHeaders) {
			for (const [header, value] of Object.entries(
				pendingQueuedAcceptanceHeaders,
			)) {
				response.setHeader(header, value);
			}
		}
		response.statusCode = 200;
		response.setHeader("Content-Type", "text/event-stream");
		response.end();
		emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		return {
			activeStreamSession: reservedSteerSession,
			assistantMessageId,
			assistantRunId: attachableRun._id,
			ok: true,
		};
	}
	if (producer.type === "convex") {
		wideEvent.assistant_run_id = producer.assistantRun._id;
		wideEvent.assistant_message_id = producer.assistantRun.assistantMessageId;
		wideEvent.tool_count = finalizedToolSet.toolCount;
		wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
		wideEvent.local_folder_root_count = 0;
		wideEvent.app_connection_count = appConnections.length;
		wideEvent.outcome = "success";
		wideEvent.status_code = 200;
		if (pendingQueuedAcceptanceHeaders) {
			for (const [header, value] of Object.entries(
				pendingQueuedAcceptanceHeaders,
			)) {
				response.setHeader(header, value);
			}
		}
		response.statusCode = 200;
		response.setHeader("Content-Type", "text/event-stream");
		response.end();
		emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		return {
			activeStreamSession: null,
			assistantMessageId: producer.assistantRun.assistantMessageId,
			assistantRunId: producer.assistantRun._id,
			ok: true,
		};
	}

	const startedRun = await startHostedChatRun({
		workspaceId,
		chatId,
		assistantMessageId,
		localCapabilitySession,
		attachableRun: producer.assistantRun ?? attachableRun,
		continueRunId: producer.assistantRun?._id ?? continueRunId,
		model,
		reasoningEffort,
		serviceTier,
		trigger,
		supersedeActiveRun,
		controllers: activeStreamSessions,
		startAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.startAssistantRun, args),
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		startActiveStream: (args) =>
			convexClient.mutation(api.chats.startActiveStream, args),
		updateActiveStream: (args) =>
			convexClient.mutation(api.chats.updateActiveStream, args),
		deleteActiveStreamSnapshot: (args) =>
			convexClient.mutation(api.chats.deleteActiveStreamSnapshot, args),
		startActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.startActiveStreamToolCall, args),
		finishActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.finishActiveStreamToolCall, args),
		transitionActiveStreamGeneration: (args) =>
			convexClient.mutation(api.chats.continueActiveWebStreamGeneration, {
				workspaceId: args.workspaceId,
				chatId: args.chatId,
				runId: args.runId,
				assistantMessageId: args.assistantMessageId,
				nextAssistantMessageId: args.nextAssistantMessageId,
				orderedMessageIds: args.orderedMessageIds,
				completedAssistantMessages: args.completedAssistantMessages.map(
					toHostedStoredMessage,
				),
				activeAssistantMessage: args.activeAssistantMessage
					? toHostedStoredMessage(args.activeAssistantMessage)
					: null,
				steerAcceptances: args.steerAcceptances,
			}),
	});
	if (!startedRun.ok) {
		if (startedRun.terminalizationError) {
			recordServerError({
				error: startedRun.terminalizationError,
				event: wideEvent,
				operation: "assistant_run_start_failure_terminalize",
			});
		}
		turnRouteErrors.send({
			eventErrorCode: "stream_start_failed",
			headers: pendingQueuedAcceptanceHeaders,
			log: { cause: startedRun.error, operation: "stream_start" },
			payload: { error: "Failed to start assistant stream." },
			statusCode: 500,
		});
		return {
			activeStreamSession: startedRun.activeStreamSession,
			claimDisposition: "release",
			ok: false,
		};
	}

	const { assistantRun } = startedRun;
	const activeStreamSession = startedRun.activeStreamSession;
	wideEvent.assistant_run_id = assistantRun._id;
	wideEvent.assistant_message_id = assistantMessageId;
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
	const finalizeAssistantRun = createHostedAssistantRunFinalizer({
		activeStreamSession,
		assistantRunId: assistantRun._id,
		chatId,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finishAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.finishAssistantRun, args),
		lastUserMessage,
		logError: ({ error, terminalization }) => {
			recordServerError({
				details:
					terminalization.status === "completed"
						? {
								message_id: terminalization.responseMessage.id,
								run_id: assistantRun._id,
							}
						: { run_id: assistantRun._id },
				error,
				event: wideEvent,
				operation:
					terminalization.status === "completed"
						? "assistant_message_persist"
						: "stream_finalize",
			});
		},
		logLatency,
		noteId,
		onCompleted: () => {
			wideEvent.outcome = "success";
			wideEvent.status_code = 200;
			emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		},
		onFailed: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "assistant_run_failed";
			emitWideEvent("error");
		},
		onWaitingForUser: () => {
			wideEvent.outcome = "success";
			wideEvent.status_code = 200;
			emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		},
		onFinalizeError: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_finalize_failed";
			emitWideEvent("error");
		},
		onTitleGenerationError: ({ error, responseMessage }) => {
			recordServerError({
				details: {
					message_id: responseMessage.id,
					run_id: assistantRun._id,
				},
				error,
				event: wideEvent,
				operation: "chat_title_generate",
			});
		},
		safetyIdentifier,
		saveAssistantMessageForRun: (args) =>
			convexClient.mutation(api.chats.saveAssistantMessageForRun, args),
		shouldGenerateChatTitle,
		updateChatTitle: (args) =>
			convexClient.mutation(api.chats.updateTitle, args),
		waitForUserDecision: (args) =>
			convexClient.mutation(api.assistantRuns.waitForUserDecision, args),
		workspaceId,
	});
	const responseStreamResult = await createHostedChatRunResponseStream({
		activeStreamSession,
		agent,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		chatMessages,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finalizeAssistantRun,
		finalizedToolSet,
		instructions,
		logLatency,
		onStreamCreateError: (error) => {
			recordServerError({
				error,
				event: wideEvent,
				operation: "stream_create",
			});
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_create_failed";
			emitWideEvent("error");
		},
		streamLatencyTracker,
	});
	if (!responseStreamResult.ok) {
		if (responseStreamResult.terminalizationError) {
			recordServerError({
				error: responseStreamResult.terminalizationError,
				event: wideEvent,
				operation: "stream_create_terminalization",
			});
		}
		if (pendingQueuedAcceptanceHeaders) {
			sendJson(
				response,
				500,
				{
					error: "Failed to create assistant stream.",
				},
				pendingQueuedAcceptanceHeaders,
			);
			return { activeStreamSession, claimDisposition: "release", ok: false };
		}
		throw responseStreamResult.error;
	}
	wideEvent.tool_count = finalizedToolSet.toolCount;
	wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
	wideEvent.local_folder_root_count = localFolderRoots.length;
	wideEvent.app_connection_count = appConnections.length;
	if (pendingQueuedAcceptanceHeaders) {
		for (const [header, value] of Object.entries(
			pendingQueuedAcceptanceHeaders,
		)) {
			response.setHeader(header, value);
		}
	}

	void pipeUiMessageStreamToServerResponse({
		response,
		stream: responseStreamResult.responseStream,
	});

	return {
		activeStreamSession,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		ok: true,
	};
};
