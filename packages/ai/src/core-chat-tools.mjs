import { openai } from "@ai-sdk/openai";
import { artifactToolOutputSchema } from "./artifact-authoring-contract.mjs";
import { createArtifactAuthoringTool } from "./artifact-authoring-tool.mjs";
import { createChartGenerationTool } from "./chart-generation-tool.mjs";
import {
	createConvexGeneratedImageUploader,
	createConvexSourceImageResolver,
	createImageGenerationTool,
} from "./image-generation-tool.mjs";

export const buildCoreChatTools = ({
	artifactAuthoringApi,
	chatAttachmentsApi,
	chatId,
	convexClient,
	webSearchEnabled,
	workspaceId,
}) => {
	const tools = {
		generate_chart: createChartGenerationTool(),
	};

	if (webSearchEnabled) {
		tools.web_search = openai.tools.webSearch({
			searchContextSize: "medium",
			userLocation: {
				type: "approximate",
				country: "US",
			},
		});
	}

	if (convexClient) {
		tools.generate_image = createImageGenerationTool({
			resolveSourceImage: createConvexSourceImageResolver({
				chatAttachmentsApi,
				chatId,
				client: convexClient,
				workspaceId,
			}),
			uploadGeneratedImage: createConvexGeneratedImageUploader({
				chatAttachmentsApi,
				client: convexClient,
			}),
		});
		tools.author_artifact = createArtifactAuthoringTool({
			authorArtifact: async ({ idempotencyKey, input }) =>
				artifactToolOutputSchema.parse(
					JSON.parse(
						await convexClient.action(artifactAuthoringApi.author, {
							workspaceId,
							chatId,
							idempotencyKey,
							inputJson: JSON.stringify(input),
						}),
					),
				),
		});
	}

	return tools;
};
