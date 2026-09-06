import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ToolLoopAgent, ToolSet } from "ai";
import type { ChatMode } from "./chat-mode.mjs";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";
import type { ProjectContext } from "./note-tools.mjs";

export type HostedChatRunPlanContext = {
	attachedNoteContext: string;
	compactionSummary: string | null;
	notesContext: string;
	projectContext: ProjectContext | null;
	recipeContext: string;
	userProfileContext?: unknown;
};

export type HostedChatRunPlanAutomationContext = {
	tools: ToolSet;
};

export declare const buildHostedChatRunPlan: (args: {
	additionalAgentTools?: ToolSet | undefined;
	appTools?: ToolSet | undefined;
	automationContext: HostedChatRunPlanAutomationContext;
	chatMode?: ChatMode;
	context: HostedChatRunPlanContext;
	coreTools: ToolSet;
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
