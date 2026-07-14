import type { UIMessage } from "ai";
import type { Id } from "../../../convex/_generated/dataModel.js";

export type ChatRequestBody = {
	id?: string;
	workspaceId?: string | null;
	trigger?: "submit-message" | "regenerate-message";
	messageId?: string;
	message?: UIMessage;
	model?: string;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	webSearchEnabled?: boolean;
	appsEnabled?: boolean;
	mentions?: string[];
	selectedSourceIds?: string[];
	timezone?: string;
	localFolders?: Array<{ id?: string; name?: string; path?: string }>;
	convexToken?: string | null;
	recipeSlug?: string | null;
	noteContext?: {
		noteId?: string | null;
		title?: string;
		text?: string;
	};
	continueRunId?: Id<"assistantRuns">;
	interruptActiveRun?: boolean;
	replayQueuedMessageId?: Id<"assistantQueuedMessages">;
	steerQueuedMessageId?: Id<"assistantQueuedMessages">;
	supersedeActiveRun?: boolean;
};

export type AttachableAssistantRun = {
	_id: Id<"assistantRuns">;
	chatId: Id<"chats">;
	status?: string;
};
