export type LinkedAccount = {
	id: string;
	providerId: string;
	accountId: string;
	scopes: string[];
};

const GOOGLE_BASE_SCOPES = ["openid", "email", "profile"] as const;

export const GOOGLE_CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_WRITE_SCOPE =
	"https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_MANAGE_SCOPE =
	"https://www.googleapis.com/auth/calendar.calendars";
export const GOOGLE_CALENDAR_LIST_MANAGE_SCOPE =
	"https://www.googleapis.com/auth/calendar.calendarlist";
export const GOOGLE_DRIVE_SCOPE =
	"https://www.googleapis.com/auth/drive.readonly";

export const GOOGLE_CALENDAR_SCOPES = [
	...GOOGLE_BASE_SCOPES,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
] as const;
export const GOOGLE_DRIVE_SCOPES = [
	...GOOGLE_BASE_SCOPES,
	GOOGLE_DRIVE_SCOPE,
] as const;

export const getGoogleLinkedAccount = (accounts: LinkedAccount[]) =>
	accounts.find((account) => account.providerId === "google");

export const hasGoogleScope = (
	account: LinkedAccount | undefined,
	scope: string,
) => account?.scopes.includes(scope) ?? false;
