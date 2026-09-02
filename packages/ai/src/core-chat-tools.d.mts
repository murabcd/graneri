import type { ToolSet } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { ChatAttachmentsApi } from "./image-generation-tool.mjs";

export type ArtifactAuthoringApi = {
	author: FunctionReference<
		"action",
		"public",
		{
			workspaceId: GenericId<"workspaces">;
			chatId: string;
			idempotencyKey: string;
			inputJson: string;
		},
		string
	>;
};

export declare const buildCoreChatTools: (args: {
	artifactAuthoringApi: ArtifactAuthoringApi;
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	convexClient: ConvexHttpClient | null | undefined;
	webSearchEnabled: boolean;
	workspaceId: GenericId<"workspaces">;
}) => ToolSet;
