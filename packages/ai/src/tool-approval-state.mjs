const asRecord = (value) =>
	value && typeof value === "object" && !Array.isArray(value) ? value : null;

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

const getToolApprovals = (message, state) => {
	if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
		return [];
	}

	const approvals = [];
	for (const value of message.parts) {
		const part = asRecord(value);
		if (part?.state !== state) {
			continue;
		}

		const approval = asRecord(part.approval);
		const approvalId = getNonEmptyString(approval?.id);
		const toolCallId = getNonEmptyString(part.toolCallId);
		const toolName = getToolName(part);
		if (!approvalId || !toolCallId || !toolName) {
			continue;
		}

		approvals.push({
			approvalId,
			assistantMessageId: message.id,
			input: part.input,
			toolCallId,
			toolName,
			...(state === "approval-responded" &&
			typeof approval.approved === "boolean"
				? { approved: approval.approved }
				: {}),
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
		storedParts = JSON.parse(storedMessage.partsJson);
	} catch {
		storedParts = null;
	}
	if (!Array.isArray(storedParts)) {
		throw new Error("Pending tool approval message is invalid.");
	}

	const responsesByToolCallId = new Map(
		approvalResponses.map((response) => [response.toolCallId, response]),
	);
	let matchedExpectedApproval = false;
	const parts = storedParts.map((value) => {
		const part = asRecord(value);
		const approval = asRecord(part?.approval);
		const response = getNonEmptyString(part?.toolCallId)
			? responsesByToolCallId.get(part.toolCallId)
			: null;
		if (
			part?.state !== "approval-requested" ||
			!response ||
			getToolName(part) !== response.toolName ||
			approval?.id !== response.approvalId
		) {
			return value;
		}

		if (response.toolCallId === approvalResponse.toolCallId) {
			matchedExpectedApproval = true;
		}
		return {
			...part,
			approval: {
				...approval,
				approved: response.approved,
				reason: response.approved ? "Approved by user." : "Denied by user.",
			},
			state: "approval-responded",
		};
	});
	if (!matchedExpectedApproval) {
		throw new Error("Pending tool approval does not match the response.");
	}

	let metadata;
	try {
		metadata = storedMessage.metadataJson
			? JSON.parse(storedMessage.metadataJson)
			: undefined;
	} catch {
		metadata = undefined;
	}

	return {
		id: storedMessage.id,
		role: "assistant",
		parts,
		...(metadata === undefined ? {} : { metadata }),
	};
};

export const getPendingToolApproval = (messages) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "user") {
			return null;
		}

		const approval = getToolApprovalRequest(message);
		if (approval) {
			return approval;
		}
	}

	return null;
};
