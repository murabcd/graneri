import type { ToolSet } from "ai";
import type { AiToolDefinition } from "./ai-tool-definition.mjs";

export type YandexTrackerToolConnection = {
	sourceId: string;
	provider: "yandex-tracker";
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
	token: string;
};

export type YandexTrackerIssue = {
	key: string;
	summary: string;
	status?: string;
	assignee?: string;
	url: string;
};

export type YandexTrackerToolAdapter = {
	searchIssues(args: { query: string; limit: number }): Promise<unknown>;
	getIssue(args: { issueKey: string }): Promise<unknown>;
};

export declare function searchYandexTrackerIssues(
	connection: YandexTrackerToolConnection,
	query: string,
	limit?: number,
): Promise<{
	connection: string;
	issues: YandexTrackerIssue[];
	sources: Array<{
		type: "url";
		url: string;
		title: string;
	}>;
}>;

export declare function getYandexTrackerIssue(
	connection: YandexTrackerToolConnection,
	issueKey: string,
): Promise<{
	connection: string;
	issue: YandexTrackerIssue;
	sources: Array<{
		type: "url";
		url: string;
		title: string;
	}>;
}>;

export declare function buildYandexTrackerTools(
	connection: YandexTrackerToolConnection,
): ToolSet;
export declare function buildYandexTrackerToolDefinitions(
	connection: YandexTrackerToolConnection,
): AiToolDefinition[];
export declare function buildYandexTrackerProxyTools(
	adapter: YandexTrackerToolAdapter,
): ToolSet;
