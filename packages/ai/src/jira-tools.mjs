import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const buildJiraUrl = (baseUrl, pathname, query) => {
	const url = new URL(baseUrl);
	const basePath = url.pathname.endsWith("/")
		? url.pathname.slice(0, -1)
		: url.pathname;
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

	url.pathname = `${basePath}${normalizedPath}`;

	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value) {
				url.searchParams.set(key, value);
			}
		}
	}

	return url;
};

const jiraHeaders = (connection) => ({
	Authorization: `Basic ${Buffer.from(`${connection.email}:${connection.token}`).toString("base64")}`,
	Accept: "application/json",
});

const toIssueUrl = (connection, key) =>
	buildJiraUrl(
		connection.baseUrl,
		`/browse/${encodeURIComponent(key)}`,
	).toString();

const extractJiraText = (value, limit = 8000) => {
	const parts = [];

	const push = (text) => {
		if (!text || parts.join("").length >= limit) {
			return;
		}

		parts.push(text);
	};

	const walk = (node) => {
		if (!node || parts.join("").length >= limit) {
			return;
		}

		if (typeof node === "string") {
			push(node);
			return;
		}

		if (Array.isArray(node)) {
			for (const item of node) {
				walk(item);
			}
			return;
		}

		if (typeof node !== "object") {
			return;
		}

		if (typeof node.text === "string") {
			push(node.text);
		}

		if (Array.isArray(node.content)) {
			for (const item of node.content) {
				walk(item);
			}
		}
	};

	walk(value);

	return parts.join("").trim().slice(0, limit);
};

const normalizeIssue = (connection, issue) => {
	if (!issue.key || typeof issue.key !== "string") {
		return null;
	}

	const fields =
		issue.fields && typeof issue.fields === "object" ? issue.fields : null;
	const summary =
		typeof fields?.summary === "string" && fields.summary.trim()
			? fields.summary
			: issue.key;
	const description = extractJiraText(fields?.description);
	const status =
		fields?.status && typeof fields.status === "object"
			? typeof fields.status.name === "string"
				? fields.status.name
				: undefined
			: undefined;
	const assignee =
		fields?.assignee && typeof fields.assignee === "object"
			? typeof fields.assignee.displayName === "string"
				? fields.assignee.displayName
				: undefined
			: undefined;

	return {
		key: issue.key,
		summary,
		description: description || undefined,
		status,
		assignee,
		url: toIssueUrl(connection, issue.key),
	};
};

const jiraRequest = async (connection, method, pathname, options = {}) => {
	const response = await fetch(
		buildJiraUrl(connection.baseUrl, pathname, options.query),
		{
			method,
			headers: {
				...jiraHeaders(connection),
				...(options.body ? { "Content-Type": "application/json" } : null),
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		},
	);

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			responseText.trim()
				? `Jira request failed: ${responseText.trim()}`
				: `Jira request failed (${response.status}).`,
		);
	}

	return await response.json();
};

const buildJiraSearchJql = (query) => {
	const normalizedQuery = query.trim();
	const issueKeyMatch = normalizedQuery.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
	const issueKeyClause = issueKeyMatch ? `key = "${issueKeyMatch[0]}"` : null;
	const terms = normalizedQuery
		.replaceAll(/["']/g, " ")
		.split(/\s+/)
		.map((term) => term.trim())
		.filter(Boolean)
		.slice(0, 8);
	const textClause =
		terms.length === 0
			? null
			: terms.length === 1
				? `text ~ "${terms[0]}"`
				: `(${terms.map((term) => `text ~ "${term}"`).join(" OR ")})`;

	if (issueKeyClause && textClause) {
		return `(${issueKeyClause} OR ${textClause}) ORDER BY updated DESC`;
	}

	if (issueKeyClause || textClause) {
		return `${issueKeyClause ?? textClause}`.replace(/^order by/i, "ORDER BY");
	}

	throw new Error("Jira search query is empty.");
};

export const searchJiraIssues = async (connection, query, limit = 5) => {
	const response = await jiraRequest(
		connection,
		"POST",
		"/rest/api/3/search/jql",
		{
			body: {
				jql: buildJiraSearchJql(query),
				maxResults: limit,
				fields: ["summary", "description", "status", "assignee"],
			},
		},
	);
	const normalizedIssues = (response.issues ?? [])
		.map((issue) => normalizeIssue(connection, issue))
		.filter(Boolean);

	return {
		connection: connection.displayName,
		issues: normalizedIssues,
		sources: normalizedIssues.map((issue) => ({
			type: "url",
			url: issue.url,
			title: issue.key,
		})),
	};
};

export const getJiraIssue = async (connection, issueKey) => {
	const issue = normalizeIssue(
		connection,
		await jiraRequest(
			connection,
			"GET",
			`/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
			{
				query: {
					fields: "summary,description,status,assignee",
				},
			},
		),
	);

	if (!issue) {
		throw new Error("Jira issue was not found.");
	}

	return {
		connection: connection.displayName,
		issue,
		sources: [
			{
				type: "url",
				url: issue.url,
				title: issue.key,
			},
		],
	};
};

export const buildJiraToolDefinitions = (connection) => [
	defineAiTool({
		name: "jira_search",
		description:
			"Search the selected Jira connection for project history, tickets, tasks, comments, assignees, status, and technical context when the request could plausibly be answered from Jira.",
		inputSchema: z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(10).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "search",
			provider: "jira",
		},
		ui: toolUiMetadata.jira_search,
		execute: async ({ query, limit }) =>
			await searchJiraIssues(connection, query, limit ?? 5),
	}),
	defineAiTool({
		name: "jira_get_issue",
		description:
			"Fetch a specific Jira issue by key when the user mentions a ticket like PROJ-123 or clearly refers to a known issue key.",
		inputSchema: z.object({
			issueKey: z.string().min(1),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "read",
			provider: "jira",
		},
		ui: toolUiMetadata.jira_get_issue,
		execute: async ({ issueKey }) => await getJiraIssue(connection, issueKey),
	}),
];

export const buildJiraTools = (connection) =>
	buildAiToolSet(buildJiraToolDefinitions(connection));
