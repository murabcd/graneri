import { openai } from "@ai-sdk/openai";
import { createIdGenerator, generateText } from "ai";
import { CHAT_MODE, getChatModeInstructions } from "./chat-mode.mjs";
import {
	buildChatTitlePrompt,
	deriveFallbackChatTitle,
	finalizeGeneratedChatTitle,
} from "./chat-titles.mjs";
import { getConvexErrorData } from "./convex-error.mjs";
import { buildHostedRoutePath } from "./hosted-route-catalog.mjs";
import { isHostedUserQuestionAnswerMessage } from "./hosted-user-question.mjs";
import { isLocalFolderToolContinuationMessage } from "./local-folder-tool-contract.mjs";
import { aiLogger, serializeError } from "./logger.mjs";
import {
	CHAT_TITLE_MODEL_ID,
	getOpenAiModelProviderOptions,
} from "./models.mjs";
import {
	buildChatHistoryInstructions,
	buildChatInstructions,
	CHAT_TITLE_INSTRUCTIONS,
} from "./prompts.mjs";
import { parseQueuedChatFilesJson } from "./queued-chat-files.mjs";
import { projectStoredUiMessagesForAssistantRun } from "./stored-ui-message-context.mjs";
import { getToolApprovalResponse } from "./tool-approval-state.mjs";
import {
	encodeUiMessage,
	tryParseUiMessageMetadataJson,
} from "./ui-message-codec.mjs";

const MAX_CHAT_PREVIEW_LENGTH = 180;
const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_NOTE_CONTEXT_LENGTH = 16_000;
export const HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE = "input_empty";

export const hostedChatSteerAcceptedHeader = "X-Graneri-Steer-Accepted";
export const hostedChatReplayAcceptedHeader = "X-Graneri-Replay-Accepted";
export const hostedChatSteerTurnIdHeader = "X-Graneri-Turn-Id";
export const hostedChatSteerQueuedMessageIdHeader =
	"X-Graneri-Queued-Message-Id";
export const hostedChatReplayQueuedMessageIdHeader =
	"X-Graneri-Replay-Queued-Message-Id";

export const getHostedChatSteerAcceptanceHeaders = ({
	queuedMessageId,
	turnId,
}) => ({
	[hostedChatSteerAcceptedHeader]: "true",
	[hostedChatSteerTurnIdHeader]: turnId,
	[hostedChatSteerQueuedMessageIdHeader]: queuedMessageId,
});

export const getHostedChatReplayAcceptanceHeaders = ({ queuedMessageId }) => ({
	[hostedChatReplayAcceptedHeader]: "true",
	[hostedChatReplayQueuedMessageIdHeader]: queuedMessageId,
});

const hostedChatSteerRejectionReasonsByErrorCode = new Map([
	["active_run_interrupt_failed", "active_run_interrupt_failed"],
	["ASSISTANT_RUN_INVARIANT_VIOLATION", "assistant_run_invariant_violation"],
	["active_run_mismatch", "expected_turn_mismatch"],
	["continue_run_id_invalid", "expected_turn_invalid"],
	["input_empty", "empty_input"],
	["input_too_large", "input_too_large"],
	["message_missing", "empty_input"],
	["queued_message_body_conflict", "invalid_request"],
	["queued_message_mode_conflict", "invalid_request"],
	["QUEUED_MESSAGE_NOT_FOUND", "queued_message_unavailable"],
	["steer_context_missing", "no_active_turn"],
	["steer_preparation_failed", "steer_preparation_failed"],
	["steer_rollback_failed", "steer_rollback_failed"],
	["steer_queue_release_failed", "steer_queue_release_failed"],
	["steer_queued_message_id_invalid", "queued_message_invalid"],
	["steer_route_required", "invalid_request"],
	["stream_create_failed", "stream_create_failed"],
	["stream_finalize_failed", "stream_finalize_failed"],
	["stream_start_failed", "stream_start_failed"],
	["user_message_persist_failed", "user_message_persist_failed"],
]);

const hostedChatConvexRouteErrorMessages = new Map([
	["AI_ADMISSION_EXPIRED", "Chat request admission expired. Please try again."],
	[
		"AI_ADMISSION_INVALID",
		"Chat request admission is no longer valid. Please try again.",
	],
	[
		"AI_ADMISSION_REQUIRED",
		"Chat request admission is required. Please try again.",
	],
	[
		"ASSISTANT_RUN_INVARIANT_VIOLATION",
		"Chat has multiple active assistant runs.",
	],
	["ASSISTANT_RUN_ACTIVE", "Chat already has an active assistant run."],
	["ASSISTANT_RUN_NOT_ACTIVE", "Assistant run is not active."],
	["ASSISTANT_RUN_NOT_FOUND", "Assistant run not found."],
	[
		"INVALID_ASSISTANT_RUN_TRANSITION",
		"Assistant run cannot accept steered user input.",
	],
	["CHAT_NOT_FOUND", "Chat not found."],
	["CHAT_BRANCH_TARGET_INVALID", "Chat branch target is invalid."],
	[
		"CHAT_BRANCH_TARGET_NOT_FOUND",
		"Chat branch target is no longer available.",
	],
	[
		"CHAT_BRANCH_TARGET_TOO_OLD",
		"Chat branch target is too far back to replace.",
	],
	[
		"CONTEXT_COMPACTION_INVALID",
		"Chat context changed while its history was being compacted.",
	],
	[
		"CONTEXT_COMPACTION_STALE",
		"Chat context changed while its history was being compacted.",
	],
	["TOOL_APPROVAL_INVALID", "Tool approval response is invalid."],
	["TOOL_APPROVAL_NOT_PENDING", "Tool approval is no longer pending."],
	["QUEUED_MESSAGE_NOT_FOUND", "Queued message is no longer available."],
	["QUEUED_MESSAGE_NOT_EDITABLE", "Queued message cannot be edited."],
]);

const hostedChatQueuedMessageConflictErrorCodes = new Set([
	"QUEUED_MESSAGE_ACCEPTANCE_CONFLICT",
	"QUEUED_MESSAGE_NOT_CLAIMED",
	"QUEUED_MESSAGE_NOT_FOUND",
]);

const hostedChatQueuedMessageServerErrorCodes = new Set([
	"QUEUED_MESSAGE_ACCEPTANCE_INVALID",
	"QUEUED_MESSAGE_ACCEPTANCE_SAVE_FAILED",
	"QUEUED_MESSAGE_SAVE_FAILED",
]);

const missingConvexFunctionPattern =
	/Could not find public function for '([^']+)'/u;

export const HOSTED_CHAT_CONVEX_DEPLOYMENT_OUT_OF_SYNC_ERROR_CODE =
	"convex_deployment_out_of_sync";

const getHostedChatConvexDeploymentSkewError = (error) => {
	const message = typeof error?.message === "string" ? error.message : "";
	const match = message.match(missingConvexFunctionPattern);
	if (!match) {
		return null;
	}

	const missingFunction = match[1];
	return {
		error: `Convex deployment is out of sync with this Graneri checkout. Missing Convex function: ${missingFunction}. Run or sync Convex for this workspace, for example with \`bunx convex dev\`, then retry the chat request.`,
		errorCode: HOSTED_CHAT_CONVEX_DEPLOYMENT_OUT_OF_SYNC_ERROR_CODE,
		statusCode: 500,
	};
};

export const getHostedChatConvexRouteError = (error) => {
	const deploymentSkewError = getHostedChatConvexDeploymentSkewError(error);
	if (deploymentSkewError) {
		return deploymentSkewError;
	}

	const data = getConvexErrorData(error);
	const code = typeof data?.code === "string" ? data.code : null;
	if (!code) {
		return null;
	}

	const isAssistantRunLifecycleError =
		code === "ASSISTANT_RUN_ACTIVE" ||
		code === "ASSISTANT_RUN_INVARIANT_VIOLATION" ||
		code === "ASSISTANT_RUN_NOT_ACTIVE" ||
		code === "ASSISTANT_RUN_NOT_FOUND" ||
		code === "INVALID_ASSISTANT_RUN_TRANSITION";
	const isAdmissionError = code.startsWith("AI_ADMISSION_");
	const isChatLifecycleError = code === "CHAT_NOT_FOUND";
	const isChatBranchTargetError =
		code === "CHAT_BRANCH_TARGET_INVALID" ||
		code === "CHAT_BRANCH_TARGET_NOT_FOUND" ||
		code === "CHAT_BRANCH_TARGET_TOO_OLD";
	const isContextCompactionConflict =
		code === "CONTEXT_COMPACTION_INVALID" ||
		code === "CONTEXT_COMPACTION_STALE";
	const isQueuedMessageError =
		code.startsWith("QUEUED_MESSAGE_") &&
		!hostedChatQueuedMessageServerErrorCodes.has(code);
	const isQueuedMessageServerError =
		hostedChatQueuedMessageServerErrorCodes.has(code);
	const isToolApprovalError = code.startsWith("TOOL_APPROVAL_");
	const isMessageSizeError =
		code === "CHAT_BRANCH_MESSAGE_TOO_LARGE" ||
		code === "CHAT_MESSAGE_TOO_LARGE" ||
		code === "CONTEXT_COMPACTION_TOO_LARGE" ||
		code === "QUEUED_MESSAGE_TOO_LARGE";
	if (
		!isAdmissionError &&
		!isAssistantRunLifecycleError &&
		!isChatBranchTargetError &&
		!isChatLifecycleError &&
		!isContextCompactionConflict &&
		!isQueuedMessageError &&
		!isQueuedMessageServerError &&
		!isToolApprovalError &&
		!isMessageSizeError
	) {
		return null;
	}

	return {
		error:
			hostedChatConvexRouteErrorMessages.get(code) ??
			(typeof data.message === "string"
				? data.message
				: "Queued chat request failed validation."),
		errorCode: isMessageSizeError ? "input_too_large" : code,
		statusCode: isQueuedMessageServerError
			? 500
			: isAdmissionError ||
					isAssistantRunLifecycleError ||
					isChatLifecycleError ||
					isContextCompactionConflict ||
					code === "CHAT_BRANCH_TARGET_NOT_FOUND" ||
					code === "CHAT_BRANCH_TARGET_TOO_OLD" ||
					hostedChatQueuedMessageConflictErrorCodes.has(code)
				? 409
				: code === "TOOL_APPROVAL_NOT_PENDING"
					? 409
					: 400,
	};
};

export const getHostedChatSteerTelemetry = ({
	acceptedTurnId,
	errorCode,
	expectedTurnId,
	isSteerRoute,
	outcome,
	queuedMessageId,
}) => {
	const isSteerAttempt = isSteerRoute || Boolean(queuedMessageId);
	if (!isSteerAttempt) {
		return null;
	}

	const accepted = Boolean(acceptedTurnId);
	const rejectionReason =
		!accepted && outcome === "error"
			? (hostedChatSteerRejectionReasonsByErrorCode.get(errorCode) ??
				errorCode ??
				"unknown")
			: null;

	return {
		turn_steer_accepted_turn_id: accepted ? acceptedTurnId : null,
		turn_steer_expected_turn_id: expectedTurnId ?? null,
		turn_steer_num_input_images: 0,
		turn_steer_queued_message_id: queuedMessageId ?? null,
		turn_steer_rejection_reason: rejectionReason,
		turn_steer_result: accepted ? "accepted" : "rejected",
	};
};

export const parseHostedChatTurnIntent = ({
	continueRunId,
	hasMessage = false,
	isSteerRoute,
	replayQueuedMessageId,
	replayQueuedMessageStatus,
	steerQueuedMessageId,
}) => {
	const validateOptionalId = (value, error, errorCode) => {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== "string" || value.length === 0) {
			return {
				error,
				errorCode,
				statusCode: 400,
			};
		}
		return null;
	};
	const invalidContinueRunId = validateOptionalId(
		continueRunId,
		"continueRunId must be a non-empty string.",
		"continue_run_id_invalid",
	);
	if (invalidContinueRunId) {
		return { ok: false, ...invalidContinueRunId };
	}
	const invalidReplayQueuedMessageId = validateOptionalId(
		replayQueuedMessageId,
		"replayQueuedMessageId must be a non-empty string.",
		"replay_queued_message_id_invalid",
	);
	if (invalidReplayQueuedMessageId) {
		return { ok: false, ...invalidReplayQueuedMessageId };
	}
	if (
		(replayQueuedMessageId &&
			!["paused", "queued"].includes(replayQueuedMessageStatus)) ||
		(!replayQueuedMessageId && replayQueuedMessageStatus !== undefined)
	) {
		return {
			ok: false,
			error:
				"replayQueuedMessageStatus must match the current queued message status.",
			errorCode: "replay_queued_message_status_invalid",
			statusCode: 400,
		};
	}
	const invalidSteerQueuedMessageId = validateOptionalId(
		steerQueuedMessageId,
		"steerQueuedMessageId must be a non-empty string.",
		"steer_queued_message_id_invalid",
	);
	if (invalidSteerQueuedMessageId) {
		return { ok: false, ...invalidSteerQueuedMessageId };
	}

	if (steerQueuedMessageId && replayQueuedMessageId) {
		return {
			ok: false,
			error: "Queued message replay and steering cannot be requested together.",
			errorCode: "queued_message_mode_conflict",
			statusCode: 400,
		};
	}

	if (replayQueuedMessageId && continueRunId) {
		return {
			ok: false,
			error: "Queued message replay cannot continue an active assistant run.",
			errorCode: "queued_replay_active_run_conflict",
			statusCode: 400,
		};
	}

	if (hasMessage && (steerQueuedMessageId || replayQueuedMessageId)) {
		return {
			ok: false,
			error:
				"Queued message replay and steering must not include a client message body.",
			errorCode: "queued_message_body_conflict",
			statusCode: 400,
		};
	}

	if (isSteerRoute) {
		if (!steerQueuedMessageId || !continueRunId) {
			return {
				ok: false,
				error:
					"steerQueuedMessageId and continueRunId are required for chat steering.",
				errorCode: "steer_context_missing",
				statusCode: 400,
			};
		}

		return {
			ok: true,
			intent: {
				type: "steer",
				queuedMessageId: steerQueuedMessageId,
				runId: continueRunId,
			},
		};
	}

	if (steerQueuedMessageId) {
		return {
			ok: false,
			error: `Queued message steering must use ${buildHostedRoutePath("chatSteer")}.`,
			errorCode: "steer_route_required",
			statusCode: 400,
		};
	}

	if (replayQueuedMessageId) {
		return {
			ok: true,
			intent: {
				type: "replay",
				expectedStatus: replayQueuedMessageStatus,
				queuedMessageId: replayQueuedMessageId,
			},
		};
	}

	return {
		ok: true,
		intent: {
			type: "direct",
			continueRunId: continueRunId ?? null,
		},
	};
};

export const getHostedChatInputValidationErrorResponse = (error) => {
	return {
		errorCode: HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE,
		payload: {
			error: error instanceof Error ? error.message : "input must not be empty",
		},
	};
};

export const validateHostedChatRequestInput = ({
	allowLocalFolderToolContinuation = false,
	message,
	turnIntent,
}) => {
	if (!message && turnIntent.type === "direct") {
		return {
			errorCode: "message_missing",
			payload: {
				error: "message is required.",
			},
			statusCode: 400,
		};
	}

	if (
		message &&
		turnIntent.type === "direct" &&
		!getToolApprovalResponse(message) &&
		!(turnIntent.continueRunId && isHostedUserQuestionAnswerMessage(message)) &&
		!(
			allowLocalFolderToolContinuation &&
			isLocalFolderToolContinuationMessage(message)
		)
	) {
		try {
			validateHostedChatInput(message);
		} catch (error) {
			const validationError = getHostedChatInputValidationErrorResponse(error);
			return {
				...validationError,
				statusCode: 400,
			};
		}
	}

	return null;
};

export const validateHostedChatActiveRunPolicy = ({
	attachableRun,
	continueRunId,
	supersedeActiveRun = false,
	trigger,
}) => {
	if (
		trigger === "regenerate-message" ||
		continueRunId ||
		supersedeActiveRun ||
		!attachableRun
	) {
		return null;
	}

	return {
		activeRunId: attachableRun._id,
		error: "Chat already has an active assistant run.",
		errorCode: "active_run_exists",
		statusCode: 409,
	};
};

const generateMessageId = createIdGenerator({
	prefix: "msg",
	size: 16,
});

export const generateHostedChatMessageId = generateMessageId;

export const clampHostedChatWhitespace = (value) =>
	value.replace(/\s+/g, " ").trim();

export const clampHostedNoteContext = (value) =>
	value.replace(/\r/g, "").trim().slice(0, MAX_NOTE_CONTEXT_LENGTH);

const truncate = (value, maxLength) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

export const getHostedChatMessageText = (message) =>
	clampHostedChatWhitespace(
		message.parts
			.filter(
				(part) =>
					part.type === "text" &&
					typeof part.text === "string" &&
					part.text.length > 0,
			)
			.map((part) => part.text)
			.join("\n\n"),
	);

export const createHostedChatInputEmptyError = () => {
	const error = new Error("input must not be empty");
	error.code = HOSTED_CHAT_INPUT_EMPTY_ERROR_CODE;
	return error;
};

export const validateHostedChatInput = (message) => {
	if (!getHostedChatMessageText(message)) {
		throw createHostedChatInputEmptyError();
	}
};

export const getHostedChatPreviewFromMessage = (message) =>
	truncate(getHostedChatMessageText(message), MAX_CHAT_PREVIEW_LENGTH);

export const toHostedStoredMessage = (message) => ({
	...encodeUiMessage({ createId: generateMessageId, message }),
	text: getHostedChatMessageText(message),
});

export const buildHostedChatSaveMessageArgs = ({
	chatId,
	message,
	noteId,
	title,
	workspaceId,
}) => ({
	workspaceId,
	chatId,
	noteId: noteId ?? undefined,
	title,
	preview: getHostedChatPreviewFromMessage(message),
	message: toHostedStoredMessage(message),
});

export const toHostedQueuedUserMessage = (queuedMessage) => {
	if (!queuedMessage.text.trim()) {
		throw new Error("Queued chat message cannot be empty.");
	}

	return {
		id: queuedMessage.messageId,
		role: "user",
		metadata: tryParseUiMessageMetadataJson(queuedMessage.metadataJson),
		parts: [
			{ type: "text", text: queuedMessage.text },
			...parseQueuedChatFilesJson(queuedMessage.filesJson),
		],
	};
};

export const prepareHostedChatBranch = ({
	interruptedAssistantMessageIds = [],
	message,
	messageId,
	messages = [],
	pendingMessages = [],
	storedMessages = [],
	trigger,
}) => {
	const interruptedAssistantMessageIdSet = new Set(
		interruptedAssistantMessageIds,
	);
	const branchStoredMessages =
		interruptedAssistantMessageIdSet.size > 0
			? storedMessages.filter(
					(storedMessage) =>
						!interruptedAssistantMessageIdSet.has(storedMessage.id),
				)
			: storedMessages;
	const editedMessageId = messageId ?? message?.id;
	const editedMessageIndex = editedMessageId
		? branchStoredMessages.findIndex(
				(storedMessage) => storedMessage.id === editedMessageId,
			)
		: -1;
	const baseStoredMessages =
		editedMessageIndex >= 0
			? branchStoredMessages.slice(0, editedMessageIndex)
			: branchStoredMessages;
	const baseMessages =
		projectStoredUiMessagesForAssistantRun(baseStoredMessages);
	const baseMessageIds = new Set(
		baseMessages.map((baseMessage) => baseMessage.id),
	);
	const pendingIncomingMessages = [];
	for (const pendingMessage of pendingMessages) {
		if (!pendingMessage || baseMessageIds.has(pendingMessage.id)) {
			continue;
		}
		pendingIncomingMessages.push(pendingMessage);
		baseMessageIds.add(pendingMessage.id);
	}
	if (message) {
		const baseMessageIndex = baseMessages.findIndex(
			(baseMessage) => baseMessage.id === message.id,
		);
		if (baseMessageIndex >= 0) {
			baseMessages[baseMessageIndex] = message;
		} else if (!baseMessageIds.has(message.id)) {
			pendingIncomingMessages.push(message);
		}
	}
	const incomingMessages = message
		? [...baseMessages, ...pendingIncomingMessages]
		: messages;
	const branchMessageId =
		messageId &&
		((trigger === "submit-message" && editedMessageIndex >= 0) ||
			trigger === "regenerate-message")
			? messageId
			: undefined;

	return {
		editedMessageIndex,
		incomingMessages,
		branchMessageId,
		shouldCreateChatBranch: Boolean(branchMessageId),
	};
};

export const getInlineHostedNoteContext = ({ title, text }) => {
	const noteTitle = title?.trim() ?? "";
	const noteText = clampHostedNoteContext(text ?? "");

	if (!noteTitle && !noteText) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		noteTitle ? `Current note title: ${noteTitle}` : "",
		noteText
			? `Current note content:\n${noteText}`
			: "Current note content: (empty note)",
	]
		.filter(Boolean)
		.join("\n\n");
};

export const getStoredHostedNoteContext = (note) => {
	if (!note) {
		return "";
	}

	return [
		"The current note is attached below. Use it as the primary context for this chat.",
		`Current note title: ${note.title}`,
		note.searchableText
			? `Current note content:\n${clampHostedNoteContext(note.searchableText)}`
			: "Current note content: (empty note)",
	].join("\n\n");
};

export const buildHostedNotesContext = (notes) => {
	if (notes.length === 0) {
		return "";
	}

	return [
		"Attached notes are available below. Use them when they are relevant to the user's request.",
		...notes.map((note, index) =>
			[
				`Note ${index + 1}: ${note.title}`,
				JSON.stringify({ noteId: note.id, project: note.project }),
				note.searchableText || "(empty note)",
			].join("\n"),
		),
	].join("\n\n");
};

export const getHostedChatRecipeContext = (selectedRecipe) => {
	if (!selectedRecipe) {
		return "";
	}

	return [
		"A recipe is selected for this chat.",
		"Treat the selected recipe as the active task framing for the conversation.",
		"Treat available notes and any other provided context as the source material to work from.",
		"If the user's request is ambiguous, interpret it through the selected recipe first.",
		"If the user explicitly asks for something else, follow the user's latest instruction instead.",
		"If there is not enough source material to complete the recipe well, ask a focused follow-up question.",
		`Selected recipe: ${selectedRecipe.name}`,
		`Recipe prompt:\n${selectedRecipe.prompt.trim()}`,
	].join("\n\n");
};

export const buildHostedChatRuntimeInstructions = ({
	attachedNoteContext = "",
	chatMode = CHAT_MODE.DEFAULT,
	compactionSummary = null,
	localFolderContext = "",
	notesContext = "",
	projectContext = null,
	recipeContext = "",
	selectedAppSourceInstructions = "",
	userProfileContext,
	webSearchEnabled = false,
}) => {
	return [
		buildChatInstructions({
			notesContext,
			attachedNoteContext,
			recipeContext,
			userProfileContext: userProfileContext ?? undefined,
			webSearchEnabled,
		}),
		projectContext
			? `Selected project context (data):\n${JSON.stringify(projectContext)}`
			: "",
		getChatModeInstructions(chatMode),
		compactionSummary === null
			? ""
			: buildChatHistoryInstructions(compactionSummary),
		localFolderContext,
		selectedAppSourceInstructions,
		localFolderContext
			? "Local folder priority: if the user's request is about a local path, shared folder, local file, local text transcript file, screenshot, or image, use the local folder tools first and do not use connected app tools unless the user explicitly asks for connected app data."
			: "",
		"Tool recovery policy: when a tool call fails, returns an unavailable result, or does not provide enough information, inspect the error and continue with another relevant available tool or source if that can still satisfy the request. Do not repeat the same failing tool call with the same arguments. If no reliable path remains, explain the specific blocker and the next action needed.",
	]
		.filter(Boolean)
		.join("\n\n");
};

export const generateHostedChatTitle = async ({
	assistantMessage,
	safetyIdentifier,
	userMessage,
}) => {
	const userText = getHostedChatMessageText(userMessage);
	const assistantText = assistantMessage
		? getHostedChatMessageText(assistantMessage)
		: "";

	if (!userText) {
		return "Quick chat";
	}

	try {
		const { text } = await generateText({
			model: openai(CHAT_TITLE_MODEL_ID),
			providerOptions: getOpenAiModelProviderOptions(CHAT_TITLE_MODEL_ID, {
				reasoningEffort: "none",
				safetyIdentifier,
			}),
			instructions: CHAT_TITLE_INSTRUCTIONS,
			prompt: buildChatTitlePrompt({
				userText,
				assistantText,
			}),
		});

		return finalizeGeneratedChatTitle({
			generatedTitle: text,
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	} catch (error) {
		aiLogger.error({
			event: "chat_title.generate_failed",
			error: serializeError(error),
			model: CHAT_TITLE_MODEL_ID,
		});
		return deriveFallbackChatTitle({
			userText,
			maxLength: MAX_CHAT_TITLE_LENGTH,
		});
	}
};
export { createHostedActiveChatStreamSession } from "./hosted-chat-active-stream.mjs";
export { buildHostedSteeredGenerationTranscript } from "./hosted-chat-stream-lifecycle.mjs";
