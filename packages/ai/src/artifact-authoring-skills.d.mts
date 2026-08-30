import type { UIMessage } from "ai";

export type ArtifactAuthoringSkillId =
	| "documents"
	| "spreadsheets"
	| "presentations"
	| "pdf";

export declare const selectArtifactAuthoringSkills: (
	message: UIMessage | undefined,
) => ArtifactAuthoringSkillId[];

export declare const buildArtifactAuthoringSkillInstruction: (
	message: UIMessage | undefined,
) => string;
