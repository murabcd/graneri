import type { JSONValue, UIMessage } from "ai";

export type ToolApprovalAuthority = {
	access: "read" | "write";
	approval: "not_required" | "required";
	provider: string;
};

export type ToolApprovalRequest = {
	approvalId: string;
	assistantMessageId: string;
	authority?: ToolApprovalAuthority;
	consequence: string;
	input: JSONValue;
	toolCallId: string;
	toolName: string;
};

export declare const getToolApprovalConsequence: (
	authority?: ToolApprovalAuthority,
) => string;

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
