export declare const MEETING_END_TRANSCRIPT_MAX_WORDS: 100;
export declare const MEETING_END_TRANSCRIPT_MAX_CHARACTERS: 10000;
export declare const MEETING_END_CLASSIFICATION_INSTRUCTIONS: string;

export type MeetingEndClassificationRequest = {
	transcript: string;
};

export type MeetingEndClassificationResponse = {
	ended: boolean;
};

export declare const buildMeetingEndClassificationPrompt: (
	transcript: string,
) => string;
