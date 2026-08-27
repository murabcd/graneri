import {
	createCanonicalToolApprovalResponse,
	getToolApprovalRequest,
	getToolApprovalResponses,
	type ToolApprovalAuthority,
	type ToolApprovalResponse,
} from "@workspace/ai/tool-approval-state";
import { decodeTrustedStoredUiMessage } from "@workspace/ai/ui-message-codec";
import type { Infer } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { pendingDecisionValidator } from "./assistantRunModel";

type ToolApprovalDecision = Extract<
	Infer<typeof pendingDecisionValidator>,
	{ type: "tool_approval" }
>;

type ToolApprovalMessageInput = {
	id: string;
	role: "assistant";
	partsJson: string;
};

const toolApprovalAuthoritiesMatch = (
	requestAuthority: ToolApprovalAuthority | undefined,
	pendingAuthority: ToolApprovalAuthority | undefined,
) =>
	requestAuthority?.access === pendingAuthority?.access &&
	requestAuthority?.approval === pendingAuthority?.approval &&
	requestAuthority?.provider === pendingAuthority?.provider;

export const requireAssistantRunToolApproval = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	pendingDecision: ToolApprovalDecision,
) => {
	const storedMessage = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q
				.eq("chatId", run.chatId)
				.eq("messageId", pendingDecision.assistantMessageId),
		)
		.unique();
	if (
		!storedMessage ||
		storedMessage.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
		storedMessage.role !== "assistant"
	) {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message: "Stored tool approval request was not found.",
		});
	}
	const request = getToolApprovalRequest({
		id: storedMessage.messageId,
		role: storedMessage.role,
		parts: parseParts(storedMessage.partsJson),
	});
	if (
		!request ||
		request.approvalId !== pendingDecision.approvalId ||
		request.toolCallId !== pendingDecision.toolCallId ||
		request.toolName !== pendingDecision.toolName ||
		request.consequence !== pendingDecision.consequence ||
		!toolApprovalAuthoritiesMatch(request.authority, pendingDecision.authority)
	) {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message:
				"Stored tool approval request does not match the pending decision.",
		});
	}
};

const parseParts = (partsJson: string) => {
	try {
		return decodeTrustedStoredUiMessage({
			id: "stored-tool-approval",
			role: "assistant",
			partsJson,
		}).parts;
	} catch {
		return [];
	}
};

export const requireMatchingToolApprovalResponse = (
	message: ToolApprovalMessageInput,
	pendingDecision: ToolApprovalDecision,
) => {
	const responses = getToolApprovalResponses({
		id: message.id,
		role: message.role,
		parts: parseParts(message.partsJson),
	});
	const pendingResponse = responses.find(
		(response) =>
			response.assistantMessageId === pendingDecision.assistantMessageId &&
			response.approvalId === pendingDecision.approvalId &&
			response.toolCallId === pendingDecision.toolCallId &&
			response.toolName === pendingDecision.toolName,
	);
	if (!pendingResponse) {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message: "Tool approval response does not match the pending tool call.",
		});
	}
	return { approved: pendingResponse.approved, responses };
};

export const createCanonicalToolApprovalMessage = (
	existingMessage: Doc<"chatMessages">,
	pendingDecision: ToolApprovalDecision,
	approvalResponses: ToolApprovalResponse[],
) => {
	const pendingResponse = approvalResponses.find(
		(response) => response.toolCallId === pendingDecision.toolCallId,
	);
	if (!pendingResponse) {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message: "Pending tool approval response was not found.",
		});
	}
	let responseMessage: ReturnType<typeof createCanonicalToolApprovalResponse>;
	try {
		responseMessage = createCanonicalToolApprovalResponse({
			approvalResponse: pendingResponse,
			approvalResponses,
			storedMessage: {
				id: existingMessage.messageId,
				role: existingMessage.role,
				partsJson: existingMessage.partsJson,
				metadataJson: existingMessage.metadataJson,
			},
		});
	} catch {
		throw new ConvexError({
			code: "TOOL_APPROVAL_INVALID",
			message: "Stored tool approval request does not match the pending run.",
		});
	}

	return {
		id: existingMessage.messageId,
		role: "assistant" as const,
		partsJson: JSON.stringify(responseMessage.parts),
		metadataJson: existingMessage.metadataJson,
		text: existingMessage.text,
		createdAt: existingMessage.createdAt,
	};
};
