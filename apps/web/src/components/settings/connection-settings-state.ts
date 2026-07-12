import { remoteMcpConnectionDefaults } from "@workspace/ai/capability-metadata";
import type {
	RemoteMcpConnectionFormState,
	RemoteMcpOAuthFields,
} from "@/lib/remote-mcp-connection-form";

export type YandexTrackerOrgType = "x-org-id" | "x-cloud-org-id";

export type YandexTrackerConnectionFormState = {
	orgType: YandexTrackerOrgType;
	orgId: string;
	token: string;
};

export type JiraConnectionFormState = {
	baseUrl: string;
	email: string;
	token: string;
};

export type RemoteMcpOAuthConnectionFormState = RemoteMcpConnectionFormState &
	RemoteMcpOAuthFields;

export type JiraMcpConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type PostHogConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type Context7ConnectionFormState = RemoteMcpConnectionFormState;
export type FigmaConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type LinearConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type NotionConnectionFormState = RemoteMcpOAuthConnectionFormState;
export type ZoomConnectionFormState = RemoteMcpOAuthConnectionFormState;

export type YandexCalendarConnectionFormState = {
	email: string;
	password: string;
};

export type CalendarSettingsState = {
	isSavingCalendarPreferences: boolean;
};

export type CalendarSettingsAction = {
	type: "setIsSavingCalendarPreferences";
	value: boolean;
};

export type AppConnectionStatus = "connected" | "disconnected";

export type YandexTrackerConnectionSettings = {
	sourceId: string;
	provider: "yandex-tracker";
	status: AppConnectionStatus;
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
};

export type YandexCalendarConnectionSettings = {
	sourceId: string;
	provider: "yandex-calendar";
	status: AppConnectionStatus;
	displayName: string;
	email: string;
	serverAddress: string;
	calendarHomePath: string;
};

export type JiraConnectionSettings = {
	sourceId: string;
	provider: "jira";
	status: AppConnectionStatus;
	displayName: string;
	baseUrl: string;
	email: string;
	accountId?: string;
	webhookSecret?: string;
	lastWebhookReceivedAt?: number;
	lastMentionSyncAt?: number;
};

export type JiraMcpConnectionSettings = {
	sourceId: string;
	provider: "jira-mcp";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type PostHogConnectionSettings = {
	sourceId: string;
	provider: "posthog";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type Context7ConnectionSettings = {
	sourceId: string;
	provider: "context7";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
};

export type FigmaConnectionSettings = {
	sourceId: string;
	provider: "figma";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type LinearConnectionSettings = {
	sourceId: string;
	provider: "linear";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type NotionConnectionSettings = {
	sourceId: string;
	provider: "notion";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type ZoomConnectionSettings = {
	sourceId: string;
	provider: "zoom";
	status: AppConnectionStatus;
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

export type StableConnectionSettings = {
	yandexTracker: YandexTrackerConnectionSettings | null;
	yandexCalendar: YandexCalendarConnectionSettings | null;
	context7: Context7ConnectionSettings | null;
	figma: FigmaConnectionSettings | null;
	linear: LinearConnectionSettings | null;
	jira: JiraConnectionSettings | null;
	jiraMcp: JiraMcpConnectionSettings | null;
	posthog: PostHogConnectionSettings | null;
	notion: NotionConnectionSettings | null;
	zoom: ZoomConnectionSettings | null;
};

export type ConnectionQueryResults = {
	yandexTracker: YandexTrackerConnectionSettings | null | undefined;
	yandexCalendar: YandexCalendarConnectionSettings | null | undefined;
	context7: Context7ConnectionSettings | null | undefined;
	figma: FigmaConnectionSettings | null | undefined;
	linear: LinearConnectionSettings | null | undefined;
	jira: JiraConnectionSettings | null | undefined;
	jiraMcp: JiraMcpConnectionSettings | null | undefined;
	posthog: PostHogConnectionSettings | null | undefined;
	notion: NotionConnectionSettings | null | undefined;
	zoom: ZoomConnectionSettings | null | undefined;
};

export type ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: boolean;
	isJiraDialogOpen: boolean;
	isSavingYandexTrackerConnection: boolean;
	isSavingJiraConnection: boolean;
	isDisablingConnection: boolean;
	yandexTrackerFormState: YandexTrackerConnectionFormState;
	jiraFormState: JiraConnectionFormState;
};

export type ConnectionsSettingsAction =
	| { type: "setIsYandexTrackerDialogOpen"; value: boolean }
	| { type: "setIsJiraDialogOpen"; value: boolean }
	| { type: "setIsSavingYandexTrackerConnection"; value: boolean }
	| { type: "setIsSavingJiraConnection"; value: boolean }
	| { type: "setIsDisablingConnection"; value: boolean }
	| {
			type: "setYandexTrackerFormState";
			value: YandexTrackerConnectionFormState;
	  }
	| {
			type: "patchYandexTrackerFormState";
			value: Partial<YandexTrackerConnectionFormState>;
	  }
	| { type: "setJiraFormState"; value: JiraConnectionFormState }
	| { type: "patchJiraFormState"; value: Partial<JiraConnectionFormState> };

export const initialYandexTrackerConnectionFormState: YandexTrackerConnectionFormState =
	{
		orgType: "x-org-id",
		orgId: "",
		token: "",
	};

export const initialYandexCalendarConnectionFormState: YandexCalendarConnectionFormState =
	{
		email: "",
		password: "",
	};

export const initialJiraConnectionFormState: JiraConnectionFormState = {
	baseUrl: "",
	email: "",
	token: "",
};

export const initialJiraMcpConnectionFormState: JiraMcpConnectionFormState = {
	name: remoteMcpConnectionDefaults["jira-mcp"].displayName,
	baseUrl: remoteMcpConnectionDefaults["jira-mcp"].endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialPostHogConnectionFormState: PostHogConnectionFormState = {
	name: remoteMcpConnectionDefaults.posthog.displayName,
	baseUrl: remoteMcpConnectionDefaults.posthog.endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialContext7ConnectionFormState: Context7ConnectionFormState = {
	name: remoteMcpConnectionDefaults.context7.displayName,
	baseUrl: remoteMcpConnectionDefaults.context7.endpoint,
	envVars: [],
};

export const initialFigmaConnectionFormState: FigmaConnectionFormState = {
	name: remoteMcpConnectionDefaults.figma.displayName,
	baseUrl: remoteMcpConnectionDefaults.figma.endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialLinearConnectionFormState: LinearConnectionFormState = {
	name: remoteMcpConnectionDefaults.linear.displayName,
	baseUrl: remoteMcpConnectionDefaults.linear.endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialNotionConnectionFormState: NotionConnectionFormState = {
	name: remoteMcpConnectionDefaults.notion.displayName,
	baseUrl: remoteMcpConnectionDefaults.notion.endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialZoomConnectionFormState: ZoomConnectionFormState = {
	name: remoteMcpConnectionDefaults.zoom.displayName,
	baseUrl: remoteMcpConnectionDefaults.zoom.endpoint,
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

export const initialCalendarSettingsState: CalendarSettingsState = {
	isSavingCalendarPreferences: false,
};

export const initialConnectionsSettingsState: ConnectionsSettingsState = {
	isYandexTrackerDialogOpen: false,
	isJiraDialogOpen: false,
	isSavingYandexTrackerConnection: false,
	isSavingJiraConnection: false,
	isDisablingConnection: false,
	yandexTrackerFormState: initialYandexTrackerConnectionFormState,
	jiraFormState: initialJiraConnectionFormState,
};

const emptyStableConnectionSettings = (): StableConnectionSettings => ({
	yandexTracker: null,
	yandexCalendar: null,
	jira: null,
	jiraMcp: null,
	context7: null,
	figma: null,
	linear: null,
	posthog: null,
	notion: null,
	zoom: null,
});

export const getStableConnectionSettingsKey = ({
	email,
	workspaceId,
}: {
	email?: string | null;
	workspaceId?: string | null;
}) => (workspaceId && email ? `${email}:${workspaceId}` : null);

export const resolveConnectionSettings = ({
	cachedSettings,
	results,
}: {
	cachedSettings?: StableConnectionSettings;
	results: ConnectionQueryResults;
}): StableConnectionSettings => {
	const cached = cachedSettings ?? emptyStableConnectionSettings();

	return {
		yandexTracker:
			results.yandexTracker === undefined
				? cached.yandexTracker
				: results.yandexTracker,
		yandexCalendar:
			results.yandexCalendar === undefined
				? cached.yandexCalendar
				: results.yandexCalendar,
		jira: results.jira === undefined ? cached.jira : results.jira,
		jiraMcp: results.jiraMcp === undefined ? cached.jiraMcp : results.jiraMcp,
		context7:
			results.context7 === undefined ? cached.context7 : results.context7,
		figma: results.figma === undefined ? cached.figma : results.figma,
		linear: results.linear === undefined ? cached.linear : results.linear,
		posthog: results.posthog === undefined ? cached.posthog : results.posthog,
		notion: results.notion === undefined ? cached.notion : results.notion,
		zoom: results.zoom === undefined ? cached.zoom : results.zoom,
	};
};

export const createStableConnectionSettingsStore = () => {
	const settingsByKey = new Map<string, StableConnectionSettings>();

	return {
		get(key: string) {
			return settingsByKey.get(key);
		},
		update(key: string, results: ConnectionQueryResults) {
			const nextSettings = resolveConnectionSettings({
				cachedSettings: settingsByKey.get(key),
				results,
			});
			settingsByKey.set(key, nextSettings);
			return nextSettings;
		},
	};
};

export const stableConnectionSettingsStore =
	createStableConnectionSettingsStore();

export const calendarSettingsReducer = (
	state: CalendarSettingsState,
	action: CalendarSettingsAction,
): CalendarSettingsState => {
	switch (action.type) {
		case "setIsSavingCalendarPreferences":
			return { ...state, isSavingCalendarPreferences: action.value };
	}
};

export const connectionsSettingsReducer = (
	state: ConnectionsSettingsState,
	action: ConnectionsSettingsAction,
): ConnectionsSettingsState => {
	switch (action.type) {
		case "setIsYandexTrackerDialogOpen":
			return { ...state, isYandexTrackerDialogOpen: action.value };
		case "setIsJiraDialogOpen":
			return { ...state, isJiraDialogOpen: action.value };
		case "setIsSavingYandexTrackerConnection":
			return { ...state, isSavingYandexTrackerConnection: action.value };
		case "setIsSavingJiraConnection":
			return { ...state, isSavingJiraConnection: action.value };
		case "setIsDisablingConnection":
			return { ...state, isDisablingConnection: action.value };
		case "setYandexTrackerFormState":
			return { ...state, yandexTrackerFormState: action.value };
		case "patchYandexTrackerFormState":
			return {
				...state,
				yandexTrackerFormState: {
					...state.yandexTrackerFormState,
					...action.value,
				},
			};
		case "setJiraFormState":
			return { ...state, jiraFormState: action.value };
		case "patchJiraFormState":
			return {
				...state,
				jiraFormState: { ...state.jiraFormState, ...action.value },
			};
	}
};
