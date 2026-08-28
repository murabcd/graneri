import type { ToolApprovalConfiguration, ToolSet } from "ai";

export type AiToolPolicy = {
	access: "read" | "write";
	approval: "not_required" | "required";
	capability: "create" | "generate" | "read" | "search" | "write";
	provider: string;
};

export type AiToolUi = {
	complete: string;
	groupLabel?: string;
	groupKey?: string;
	icon: string;
	running: string;
	subtitleKeys?: string[];
};

export declare const createAiToolMetadata: (args: {
	policy: AiToolPolicy;
	ui: AiToolUi;
}) => {
	graneri: {
		authority: AiToolPolicy;
	};
	ui: AiToolUi;
};

export declare const buildAiToolApprovalConfiguration: (
	tools: ToolSet | undefined,
) => ToolApprovalConfiguration<ToolSet, never> | undefined;

export declare const classifyRemoteMcpToolPolicy: (args: {
	annotations?: {
		readOnlyHint?: boolean;
	};
	provider: string;
}) => AiToolPolicy;
