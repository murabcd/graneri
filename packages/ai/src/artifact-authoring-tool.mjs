import { defineAiTool } from "./ai-tool-definition.mjs";
import {
	ARTIFACT_AUTHORING_TOOL_NAME,
	ARTIFACT_TOOL_NAMESPACE,
	artifactAuthoringInputSchema,
	artifactToolOutputSchema,
} from "./artifact-authoring-contract.mjs";
import { ARTIFACT_AUTHORING_SKILL_DESCRIPTION } from "./artifact-authoring-skills.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const ARTIFACT_AUTHORING_TOOL_DESCRIPTION = [
	"Create, edit, or export a downloadable DOCX, PDF, XLSX, or PPTX file only when the user explicitly asks for one of those file outputs. Do not use this for an ordinary chat answer, markdown table, visual chart, or generated image. Choose one schema operation and provide complete structured content or explicit edits; never provide code to execute. For edits, copy exact owned source metadata from the conversation. The UI presents successful outputs as file cards, so respond afterward with only a brief confirmation and no download link.",
	ARTIFACT_AUTHORING_SKILL_DESCRIPTION,
].join("\n\n");

const artifactOutputForModel = ({ output }) => {
	const { artifacts } = artifactToolOutputSchema.parse(output);
	const artifactMetadata = artifacts.map(
		({ filename, mediaType, providerMetadata, sizeBytes }) => ({
			filename,
			mediaType,
			providerMetadata,
			sizeBytes,
		}),
	);

	return {
		type: "text",
		value: [
			"Artifact authoring succeeded.",
			"The chat UI already presents every artifact as a file card. Respond with a brief plain-text confirmation only; do not write a URL, Markdown link, or download label.",
			`Artifact metadata for later edits: ${JSON.stringify(artifactMetadata)}`,
		].join("\n"),
	};
};

export const createArtifactAuthoringTool = ({ authorArtifact }) =>
	defineAiTool({
		name: ARTIFACT_AUTHORING_TOOL_NAME,
		description: ARTIFACT_AUTHORING_TOOL_DESCRIPTION,
		inputSchema: artifactAuthoringInputSchema,
		namespace: ARTIFACT_TOOL_NAMESPACE,
		policy: {
			access: "write",
			approval: "not_required",
			capability: "generate",
			provider: "graneri",
		},
		toModelOutput: artifactOutputForModel,
		ui: toolUiMetadata.author_artifact,
		execute: async (input, options) =>
			await authorArtifact({
				idempotencyKey: options.toolCallId,
				input,
			}),
	}).toAITool();
