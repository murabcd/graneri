import { defineAiTool } from "./ai-tool-definition.mjs";
import {
	ARTIFACT_AUTHORING_TOOL_NAMES,
	ARTIFACT_TOOL_NAMESPACE,
	artifactToolOutputSchema,
	documentAuthoringInputSchema,
	pdfAuthoringInputSchema,
	presentationAuthoringInputSchema,
	spreadsheetAuthoringInputSchema,
} from "./artifact-authoring-contract.mjs";
import {
	DOCUMENT_AUTHORING_SKILL_DESCRIPTION,
	PDF_AUTHORING_SKILL_DESCRIPTION,
	PRESENTATION_AUTHORING_SKILL_DESCRIPTION,
	SPREADSHEET_AUTHORING_SKILL_DESCRIPTION,
} from "./artifact-authoring-skills.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const COMMON_ARTIFACT_AUTHORING_GUIDANCE =
	"Choose one schema operation and provide complete structured content or explicit edits; never provide code to execute. For edits, copy exact owned source metadata from the conversation. The UI presents successful outputs as file cards, so respond afterward with only a brief confirmation and no download link.";

const ARTIFACT_AUTHORING_TOOL_CONFIGS = [
	{
		description: [
			"Create or edit a downloadable DOCX document when the user explicitly requests a Word document or DOCX file. A new document operation must emit DOCX first and may emit a PDF copy second when explicitly requested. Do not use it for a PDF-only request, ordinary chat answer, markdown table, visual chart, generated image, spreadsheet, or presentation.",
			COMMON_ARTIFACT_AUTHORING_GUIDANCE,
			DOCUMENT_AUTHORING_SKILL_DESCRIPTION,
		].join("\n\n"),
		inputSchema: documentAuthoringInputSchema,
		name: ARTIFACT_AUTHORING_TOOL_NAMES.document,
	},
	{
		description: [
			"Create, edit, or export a downloadable PDF when the user explicitly requests a PDF file or DOCX-to-PDF conversion. Do not use it for a DOCX-only request, ordinary chat answer, markdown table, visual chart, generated image, spreadsheet, or presentation.",
			COMMON_ARTIFACT_AUTHORING_GUIDANCE,
			PDF_AUTHORING_SKILL_DESCRIPTION,
		].join("\n\n"),
		inputSchema: pdfAuthoringInputSchema,
		name: ARTIFACT_AUTHORING_TOOL_NAMES.pdf,
	},
	{
		description: [
			"Create or edit a downloadable PPTX presentation when the user explicitly requests a slide deck, PowerPoint presentation, or PPTX file. Do not use it for an ordinary chat answer, document, PDF, markdown table, visual chart, generated image, or spreadsheet.",
			COMMON_ARTIFACT_AUTHORING_GUIDANCE,
			PRESENTATION_AUTHORING_SKILL_DESCRIPTION,
		].join("\n\n"),
		inputSchema: presentationAuthoringInputSchema,
		name: ARTIFACT_AUTHORING_TOOL_NAMES.presentation,
	},
	{
		description: [
			"Create or edit a downloadable XLSX workbook when the user explicitly requests an Excel workbook, spreadsheet file, or XLSX output. Do not use it for an ordinary chat answer, document, PDF, markdown table, visual chart without a workbook, generated image, or presentation.",
			COMMON_ARTIFACT_AUTHORING_GUIDANCE,
			SPREADSHEET_AUTHORING_SKILL_DESCRIPTION,
		].join("\n\n"),
		inputSchema: spreadsheetAuthoringInputSchema,
		name: ARTIFACT_AUTHORING_TOOL_NAMES.spreadsheet,
	},
];

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
			"The chat UI already presents every artifact as a file card. If the user requested saving it in their shared local folder, call save_local_file with the storageId below. Then respond with a brief confirmation; do not write a download URL or link.",
			`Artifact metadata for later edits: ${JSON.stringify(artifactMetadata)}`,
		].join("\n"),
	};
};

export const createArtifactAuthoringTools = ({ authorArtifact }) =>
	Object.fromEntries(
		ARTIFACT_AUTHORING_TOOL_CONFIGS.map(
			({ description, inputSchema, name }) => [
				name,
				defineAiTool({
					name,
					description,
					inputSchema,
					namespace: ARTIFACT_TOOL_NAMESPACE,
					policy: {
						access: "write",
						approval: "not_required",
						capability: "generate",
						provider: "graneri",
					},
					toModelOutput: artifactOutputForModel,
					ui: toolUiMetadata[name],
					execute: async (input, options) =>
						await authorArtifact({
							idempotencyKey: options.toolCallId,
							input,
						}),
				}).toAITool(),
			],
		),
	);
