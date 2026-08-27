import {
	createCanonicalHostedUserQuestionAnswer,
	type HostedUserQuestionPendingDecision,
} from "@workspace/ai/hosted-user-question";
import { createCanonicalLocalFolderToolContinuation } from "@workspace/ai/local-folder-tool-contract";
import {
	createCanonicalToolApprovalResponse,
	type ToolApprovalResponse,
} from "@workspace/ai/tool-approval-state";
import type { UIMessage } from "ai";

type StoredAssistantMessage = NonNullable<
	Parameters<
		typeof createCanonicalLocalFolderToolContinuation
	>[0]["storedMessage"]
>;

const toStoredAssistantMessage = (
	message: UIMessage,
): StoredAssistantMessage => {
	if (message.role !== "assistant") {
		throw new Error("Assistant continuation must remain an assistant message.");
	}
	return {
		id: message.id,
		role: message.role,
		partsJson: JSON.stringify(message.parts),
		...(message.metadata !== undefined && {
			metadataJson: JSON.stringify(message.metadata),
		}),
	};
};

export const createCanonicalChatAssistantContinuation = ({
	approval,
	localFolderToolContinuation,
	storedMessage,
	userQuestion,
}: {
	approval: {
		response: ToolApprovalResponse;
		responses: ToolApprovalResponse[];
	} | null;
	localFolderToolContinuation: UIMessage | null;
	storedMessage: StoredAssistantMessage | null | undefined;
	userQuestion: {
		answer: string;
		decision: HostedUserQuestionPendingDecision;
	} | null;
}) => {
	let canonicalMessage: UIMessage | null = null;
	if (userQuestion) {
		canonicalMessage = createCanonicalHostedUserQuestionAnswer({
			answer: userQuestion.answer,
			decision: userQuestion.decision,
			storedMessage,
		});
	}
	if (approval) {
		canonicalMessage = createCanonicalToolApprovalResponse({
			approvalResponse: approval.response,
			approvalResponses: approval.responses,
			storedMessage: canonicalMessage
				? toStoredAssistantMessage(canonicalMessage)
				: storedMessage,
		});
	}

	if (localFolderToolContinuation) {
		canonicalMessage = createCanonicalLocalFolderToolContinuation({
			message: localFolderToolContinuation,
			storedMessage: canonicalMessage
				? toStoredAssistantMessage(canonicalMessage)
				: storedMessage,
		});
	}

	if (!canonicalMessage) {
		throw new Error("Assistant continuation is invalid.");
	}
	return canonicalMessage;
};
