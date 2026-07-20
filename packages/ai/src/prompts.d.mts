export declare const BASE_CHAT_INSTRUCTIONS: string;
export declare const CHAT_TITLE_INSTRUCTIONS: string;
export declare const ENHANCED_NOTE_INSTRUCTIONS: string;
export declare const APPLY_TEMPLATE_INSTRUCTIONS: string;

export declare function buildChatHistoryInstructions(summary: string): string;

export declare function buildChatInstructions(options?: {
	notesContext?: string;
	attachedNoteContext?: string;
	recipeContext?: string;
	userProfileContext?: {
		name?: string | null;
		jobTitle?: string | null;
		companyName?: string | null;
	};
	webSearchEnabled?: boolean;
}): string;

export declare function buildEnhancedNotePrompt(options?: {
	title?: string;
	rawNotes?: string;
	transcript?: string;
	noteText?: string;
}): string;

export declare function buildApplyTemplatePrompt(options?: {
	title?: string;
	templateName?: string;
	meetingContext?: string;
	templateSections?: Array<{
		title: string;
		prompt?: string;
	}>;
	noteText?: string;
}): string;
