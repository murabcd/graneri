import type { UIMessage } from "ai";

export type ToolApprovalRequest = {
	approvalId: string;
	assistantMessageId: string;
	input: unknown;
	toolCallId: string;
	toolName: string;
};

export type ToolApprovalResponse = ToolApprovalRequest & {
	approved: boolean;
};

export type StoredToolApprovalMessage = {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson?: string;
};

export declare const getToolApprovalRequest: (
	message: UIMessage,
) => ToolApprovalRequest | null;
export declare const getToolApprovalResponse: (
	message: UIMessage,
) => ToolApprovalResponse | null;
export declare const getToolApprovalResponses: (
	message: UIMessage,
) => ToolApprovalResponse[];
export declare const createCanonicalToolApprovalResponse: (args: {
	approvalResponse: ToolApprovalResponse;
	approvalResponses?: ToolApprovalResponse[];
	storedMessage: StoredToolApprovalMessage | null | undefined;
}) => UIMessage;
export declare const getPendingToolApproval: (
	messages: UIMessage[],
) => ToolApprovalRequest | null;
