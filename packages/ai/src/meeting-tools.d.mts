import type { ToolSet } from "ai";

export type MeetingSearchInput = {
	query: string;
	from?: string;
	to?: string;
	limit?: number;
};

export type MeetingSearchResult = {
	hasMore: boolean;
	matchedCompanies: Array<{
		displayName: string;
		domain: string;
	}>;
	matchedPeople: Array<{
		displayName?: string;
		email: string;
	}>;
	meetings: Array<{
		endAt: string;
		htmlLink?: string;
		matchedCompanies: string[];
		matchedPeople: string[];
		meetingUrl?: string;
		noteId: string;
		provider: "google" | "yandex";
		searchableText: string;
		searchableTextTruncated: boolean;
		startAt: string;
		title: string;
	}>;
};

export declare function buildMeetingTools(args: {
	searchMeetings: (input: MeetingSearchInput) => Promise<MeetingSearchResult>;
}): ToolSet;
