export declare const PROJECT_DESCRIPTION_PROJECT_NAME_MAX_LENGTH: 48;
export declare const PROJECT_DESCRIPTION_MAX_LENGTH: 255;
export declare const PROJECT_DESCRIPTION_CONTEXT_MAX_NOTES: 20;
export declare const PROJECT_DESCRIPTION_CONTEXT_NOTE_TITLE_MAX_LENGTH: 120;
export declare const PROJECT_DESCRIPTION_CONTEXT_NOTE_TEXT_MAX_LENGTH: 1_000;

export type ProjectDescriptionContextNote = {
	title: string;
	text: string;
};

export type GenerateProjectDescriptionRequest = {
	projectName: string;
	currentDescription: string;
	notes: ProjectDescriptionContextNote[];
};
