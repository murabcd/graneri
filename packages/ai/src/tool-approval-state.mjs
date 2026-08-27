import { z } from "zod";
import {
	parseUiMessagePartsJson,
	tryParseUiMessageMetadataJson,
} from "./ui-message-codec.mjs";

const toolApprovalPartSchema = z.looseObject({
	approval: z.looseObject({
		approved: z.boolean().optional(),
		id: z.string().min(1),
	}),
	input: z.json(),
	state: z.enum(["approval-requested", "approval-responded"]),
	toolMetadata: z
		.looseObject({
			graneri: z
				.looseObject({
					authority: z.looseObject({
						access: z.enum(["read", "write"]),
						approval: z.enum(["not_required", "required"]),
						provider: z.string().min(1),
					}),
				})
				.optional(),
		})
		.optional(),
	toolCallId: z.string().min(1),
	toolName: z.string().optional(),
	type: z.string(),
});

const getNonEmptyString = (value) =>
	typeof value === "string" && value.length > 0 ? value : null;

const getToolName = (part) => {
	if (part.type === "dynamic-tool") {
		return getNonEmptyString(part.toolName);
	}

	return typeof part.type === "string" && part.type.startsWith("tool-")
		? getNonEmptyString(part.type.slice("tool-".length))
		: null;
};

export const getToolApprovalConsequence = (authority) =>
	authority?.access === "read"
		? "This action can read data from a connected service."
		: "This action can change data or perform an external action.";

const getToolApprovals = (message, state) => {
	if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
		return [];
	}

	const approvals = [];
	for (const value of message.parts) {
		const result = toolApprovalPartSchema.safeParse(value);
		if (!result.success || result.data.state !== state) {
			continue;
		}
		const part = result.data;
		const approvalId = part.approval.id;
		const toolCallId = part.toolCallId;
		const toolName = getToolName(part);
		if (!approvalId || !toolCallId || !toolName) {
			continue;
		}

		approvals.push({
			approvalId,
			assistantMessageId: message.id,
			authority: part.toolMetadata?.graneri?.authority,
			consequence: getToolApprovalConsequence(
				part.toolMetadata?.graneri?.authority,
			),
			input: part.input,
			toolCallId,
			toolName,
			...(state === "approval-responded" &&
				typeof part.approval.approved === "boolean" && {
					approved: part.approval.approved,
				}),
		});
	}

	return approvals;
};

export const getToolApprovalRequest = (message) =>
	getToolApprovals(message, "approval-requested").at(-1) ?? null;

export const getToolApprovalResponses = (message) =>
	getToolApprovals(message, "approval-responded").filter(
		(response) => typeof response.approved === "boolean",
	);

export const getToolApprovalResponse = (message) =>
	getToolApprovalResponses(message).at(-1) ?? null;

export const createCanonicalToolApprovalResponse = ({
	approvalResponse,
	approvalResponses = [approvalResponse],
	storedMessage,
}) => {
	if (
		storedMessage?.role !== "assistant" ||
		storedMessage.id !== approvalResponse.assistantMessageId
	) {
		throw new Error("Pending tool approval message was not found.");
	}

	let storedParts;
	try {
		storedParts = parseUiMessagePartsJson(storedMessage.partsJson);
	} catch {
		throw new Error("Pending tool approval message is invalid.");
	}

	const responsesByToolCallId = new Map(
		approvalResponses.map((response) => [response.toolCallId, response]),
	);
	let matchedExpectedApproval = false;
	const parts = storedParts.map((value) => {
		const result = toolApprovalPartSchema.safeParse(value);
		if (!result.success) return value;
		const part = result.data;
		const response = responsesByToolCallId.get(part.toolCallId);
		if (
			part.state !== "approval-requested" ||
			!response ||
			getToolName(part) !== response.toolName ||
			part.approval.id !== response.approvalId
		) {
			return value;
		}

		if (response.toolCallId === approvalResponse.toolCallId) {
			matchedExpectedApproval = true;
		}
		return {
			...part,
			approval: {
				...part.approval,
				approved: response.approved,
				reason: response.approved ? "Approved by user." : "Denied by user.",
			},
			state: "approval-responded",
		};
	});
	if (!matchedExpectedApproval) {
		throw new Error("Pending tool approval does not match the response.");
	}

	const metadata = tryParseUiMessageMetadataJson(storedMessage.metadataJson);

	return {
		id: storedMessage.id,
		role: "assistant",
		parts,
		...(metadata !== undefined && { metadata }),
	};
};
