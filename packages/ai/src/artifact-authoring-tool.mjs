import { defineAiTool } from "./ai-tool-definition.mjs";
import {
	ARTIFACT_AUTHORING_TOOL_NAME,
	artifactAuthoringInputSchema,
	artifactToolOutputSchema,
} from "./artifact-authoring-contract.mjs";
import {
	buildArtifactAuthoringSkillInstruction,
	selectArtifactAuthoringSkills,
} from "./artifact-authoring-skills.mjs";
import { extractTextFromUIMessage } from "./local-path-references.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const artifactActionPattern =
	/\b(add|append|build|change|convert|create|delete|draft|edit|export|format|generate|insert|make|modify|prepare|produce|remove|reorder|revise|save|turn|update|write)\b/iu;

export const shouldEnableArtifactAuthoring = (message) => {
	if (!message) {
		return false;
	}
	const text = extractTextFromUIMessage(message);
	return (
		artifactActionPattern.test(text) &&
		selectArtifactAuthoringSkills(message).length > 0
	);
};

export const buildArtifactAuthoringInstruction = (message) =>
	[
		"Use author_artifact whenever the user asks to create or edit a DOCX, PDF, XLSX, or PPTX file.",
		"Choose one explicit operation kind and provide complete structured content or explicit edit operations; never describe code to execute.",
		"For an edit, copy the source filename, media type, and Graneri storage id exactly from the relevant file or earlier artifact metadata.",
		"After author_artifact succeeds, briefly confirm completion without repeating artifact URLs or Markdown download links; the chat UI presents each returned artifact as a file card.",
		buildArtifactAuthoringSkillInstruction(message),
	]
		.filter(Boolean)
		.join("\n\n");

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
		description:
			"Create, edit, or export validated DOCX, PDF, XLSX, and PPTX artifacts using trusted server-side authoring modules.",
		inputSchema: artifactAuthoringInputSchema,
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
