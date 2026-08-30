import { ARTIFACT_MEDIA_TYPES } from "./artifact-authoring-contract.mjs";
import { ARTIFACT_AUTHORING_SKILLS } from "./artifact-authoring-skills.generated.mjs";
import { extractTextFromUIMessage } from "./local-path-references.mjs";

const skillPatterns = {
	documents: /\b(docx?|document|microsoft word|word file)\b/iu,
	spreadsheets: /\b(excel|sheets?|spreadsheet|workbook|worksheets?|xlsx)\b/iu,
	presentations: /\b(deck|powerpoint|pptx|presentation|slide deck|slides?)\b/iu,
	pdf: /\bpdfs?\b/iu,
};
const skillByMediaType = new Map([
	[ARTIFACT_MEDIA_TYPES.docx, "documents"],
	[ARTIFACT_MEDIA_TYPES.xlsx, "spreadsheets"],
	[ARTIFACT_MEDIA_TYPES.pptx, "presentations"],
	[ARTIFACT_MEDIA_TYPES.pdf, "pdf"],
]);

export const selectArtifactAuthoringSkills = (message) => {
	if (!message) {
		return [];
	}
	const selected = new Set();
	const text = extractTextFromUIMessage(message);
	for (const [skillId, pattern] of Object.entries(skillPatterns)) {
		if (pattern.test(text)) {
			selected.add(skillId);
		}
	}
	for (const part of message.parts) {
		if (part.type !== "file") {
			continue;
		}
		const skillId = skillByMediaType.get(part.mediaType);
		if (skillId) {
			selected.add(skillId);
		}
	}
	return Object.keys(skillPatterns).filter((skillId) => selected.has(skillId));
};

export const buildArtifactAuthoringSkillInstruction = (message) =>
	selectArtifactAuthoringSkills(message)
		.map((skillId) => ARTIFACT_AUTHORING_SKILLS[skillId])
		.join("\n\n");
