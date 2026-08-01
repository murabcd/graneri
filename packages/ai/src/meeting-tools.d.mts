import type { ToolSet } from "ai";

export type MeetingSearchInput = {
	query: string;
	from?: string;
	to?: string;
	limit?: number;
};

export declare function buildMeetingTools(args: {
	searchMeetings: (input: MeetingSearchInput) => Promise<unknown>;
}): ToolSet;
