export type GoogleCalendarListResponse = {
	items?: GoogleCalendarListEntry[];
};

export type GoogleCalendarListEntry = {
	accessRole?: string;
	backgroundColor?: string;
	hidden?: boolean;
	id: string;
	primary?: boolean;
	selected?: boolean;
	summary?: string;
	summaryOverride?: string;
};
