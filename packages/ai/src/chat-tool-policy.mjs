import { openai } from "@ai-sdk/openai";
import { artifactToolOutputSchema } from "./artifact-authoring-contract.mjs";
import {
	buildArtifactAuthoringInstruction,
	createArtifactAuthoringTool,
	shouldEnableArtifactAuthoring,
} from "./artifact-authoring-tool.mjs";
import {
	buildChartGenerationInstruction,
	buildChartGenerationPrepareStep,
	createChartGenerationTool,
	shouldEnableChartGeneration,
} from "./chart-generation-tool.mjs";
import {
	buildImageGenerationInstruction,
	createConvexGeneratedImageUploader,
	createConvexSourceImageResolver,
	createImageGenerationTool,
	shouldEnableImageGeneration,
} from "./image-generation-tool.mjs";

export const buildCoreChatToolPolicy = ({
	artifactAuthoringApi,
	chatAttachmentsApi,
	chatId,
	convexClient,
	message,
	webSearchEnabled,
	workspaceId,
}) => {
	const artifactAuthoringRequested = shouldEnableArtifactAuthoring(message);
	const artifactAuthoringEnabled = Boolean(
		artifactAuthoringApi && convexClient && artifactAuthoringRequested,
	);
	const imageGenerationRequested = shouldEnableImageGeneration(message);
	const imageGenerationEnabled = Boolean(
		convexClient && imageGenerationRequested,
	);
	const chartGenerationRequested = shouldEnableChartGeneration(message);
	const enabledTools = {};

	if (webSearchEnabled) {
		enabledTools.web_search = openai.tools.webSearch({
			searchContextSize: "medium",
			userLocation: {
				type: "approximate",
				country: "US",
			},
		});
	}

	if (imageGenerationEnabled) {
		enabledTools.generate_image = createImageGenerationTool({
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
	}

	if (artifactAuthoringEnabled) {
		enabledTools.author_artifact = createArtifactAuthoringTool({
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

	if (chartGenerationRequested) {
		enabledTools.generate_chart = createChartGenerationTool();
	}

	return {
		enabledTools,
		instruction: [
			artifactAuthoringEnabled ? buildArtifactAuthoringInstruction() : "",
			chartGenerationRequested ? buildChartGenerationInstruction() : "",
			imageGenerationEnabled ? buildImageGenerationInstruction() : "",
		]
			.filter(Boolean)
			.join("\n\n"),
		prepareStep: chartGenerationRequested
			? buildChartGenerationPrepareStep()
			: undefined,
		state: {
			artifactAuthoringEnabled,
			artifactAuthoringRequested,
			chartGenerationRequested,
			imageGenerationEnabled,
			imageGenerationRequested,
			webSearchEnabled,
		},
	};
};
