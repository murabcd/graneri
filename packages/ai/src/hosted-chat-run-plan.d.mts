import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { PrepareStepFunction, ToolLoopAgent, ToolSet } from "ai";
import type { ChatMode } from "./chat-mode.mjs";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";

export type HostedChatRunPlanContext = {
	attachedNoteContext: string;
	compactionSummary: string | null;
	notesContext: string;
	recipeContext: string;
	userProfileContext?: unknown;
};

export type HostedChatRunPlanCoreToolPolicy = {
	enabledTools: ToolSet;
	instruction: string;
	prepareStep?: PrepareStepFunction<ToolSet> | undefined;
};

export type HostedChatRunPlanAutomationContext = {
	instruction: string;
	tools: ToolSet;
};

export declare const buildHostedChatRunPlan: (args: {
	additionalAgentTools?: ToolSet | undefined;
	appTools?: ToolSet | undefined;
	automationContext: HostedChatRunPlanAutomationContext;
	chatMode?: ChatMode;
	context: HostedChatRunPlanContext;
	coreToolPolicy: HostedChatRunPlanCoreToolPolicy;
	emptyToolsWhenNone?: boolean;
	getActiveStreamSession?: (() => HostedActiveStreamSession | null) | undefined;
	localFolderContext?: string;
	localFolderTools?: ToolSet | undefined;
	model: string;
	providerOptions?: ProviderOptions | undefined;
	selectedAppSourceInstructions?: string;
	webSearchEnabled?: boolean;
}) => {
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	enabledTools: ToolSet;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	instructions: string;
	tools: ToolSet;
};
