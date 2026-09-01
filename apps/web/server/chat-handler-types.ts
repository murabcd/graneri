import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { ServiceTier } from "@workspace/ai/models";
import type { UIMessage } from "ai";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api.js";

export type ChatRequestBody = {
	chatMode?: unknown;
	id?: string;
	projectId?: string | null;
	workspaceId?: string | null;
	trigger?: "submit-message" | "regenerate-message";
	messageId?: string;
	message?: UIMessage;
	model?: string;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	serviceTier?: ServiceTier;
	webSearchEnabled?: boolean;
	appsEnabled?: boolean;
	mentions?: string[];
	selectedSourceIds?: string[];
	timezone?: string;
	localCapabilitySession?: LocalCapabilitySession | null;
	convexToken?: string | null;
	recipeSlug?: string | null;
	noteContext?: {
		noteId?: string | null;
		title?: string;
		text?: string;
	};
	continueRunId?: unknown;
	interruptActiveRun?: boolean;
	replayQueuedMessageId?: unknown;
	replayQueuedMessageStatus?: unknown;
	steerQueuedMessageId?: unknown;
	supersedeActiveRun?: boolean;
};

export type AttachableAssistantRun = NonNullable<
	FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
>;
