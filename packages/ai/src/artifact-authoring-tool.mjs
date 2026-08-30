import { defineAiTool } from "./ai-tool-definition.mjs";
import {
	ARTIFACT_AUTHORING_TOOL_NAME,
	ARTIFACT_MEDIA_TYPES,
	artifactAuthoringInputSchema,
} from "./artifact-authoring-contract.mjs";
import { extractTextFromUIMessage } from "./local-path-references.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const artifactMediaTypes = new Set(Object.values(ARTIFACT_MEDIA_TYPES));
const artifactActionPattern =
	/\b(add|append|build|change|convert|create|delete|draft|edit|export|format|generate|insert|make|modify|prepare|produce|remove|reorder|revise|save|turn|update|write)\b/iu;
const artifactTargetPattern =
	/\b(artifact|attachment|deck|docx?|document|excel|file|pdf|powerpoint|presentation|sheets?|slides?|spreadsheet|word|workbook|xlsx|pptx)\b/iu;

export const shouldEnableArtifactAuthoring = (message) => {
	if (!message) {
		return false;
	}
	const text = extractTextFromUIMessage(message);
	const hasArtifactAttachment = message.parts.some(
		(part) => part.type === "file" && artifactMediaTypes.has(part.mediaType),
	);
	return (
		artifactActionPattern.test(text) &&
		(artifactTargetPattern.test(text) || hasArtifactAttachment)
	);
};

export const buildArtifactAuthoringInstruction = () =>
	[
		"Use author_artifact whenever the user asks to create or edit a DOCX, PDF, XLSX, or PPTX file.",
		"Choose one explicit operation kind and provide complete structured content or explicit edit operations; never describe code to execute.",
		"For an edit, copy the source filename, media type, and Graneri storage id exactly from the relevant file or earlier artifact metadata.",
		"Use document_export to convert an existing DOCX source to one PDF without inventing an edit.",
		"Use document_create with two outputs when the user wants both DOCX and PDF. Each returned artifact is already validated and should be presented without recreating or converting it.",
	].join(" ");

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
		ui: toolUiMetadata.author_artifact,
		execute: async (input, options) =>
			await authorArtifact({
				idempotencyKey: options.toolCallId,
				input,
			}),
	}).toAITool();
