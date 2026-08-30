import type { ToolSet, UIMessage } from "ai";
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

export declare const buildCoreChatToolPolicy: ({
	artifactAuthoringApi,
	chatAttachmentsApi,
	chatId,
	convexClient,
	message,
	webSearchEnabled,
	workspaceId,
}: {
	artifactAuthoringApi: ArtifactAuthoringApi;
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	convexClient: ConvexHttpClient | null | undefined;
	message: UIMessage | undefined;
	webSearchEnabled: boolean;
	workspaceId: GenericId<"workspaces">;
}) => {
	enabledTools: ToolSet;
	instruction: string;
	prepareStep:
		| (({ stepNumber }: { stepNumber: number }) => {
				toolChoice: { type: "tool"; toolName: "generate_chart" } | "auto";
		  })
		| undefined;
	state: {
		artifactAuthoringEnabled: boolean;
		artifactAuthoringRequested: boolean;
		chartGenerationRequested: boolean;
		imageGenerationEnabled: boolean;
		imageGenerationRequested: boolean;
		webSearchEnabled: boolean;
	};
};
