"use node";

import {
	APP_SOURCE_PREFIX,
	isRemoteMcpConnectionProvider,
	type RemoteMcpConnectionProvider,
} from "@workspace/ai/capability-metadata";
import {
	executeRemoteMcpToolForProxy,
	listRemoteMcpToolsForProxy,
} from "@workspace/ai/remote-mcp-tools";
import {
	getYandexTrackerIssue,
	searchYandexTrackerIssues,
} from "@workspace/ai/yandex-tracker-tools";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action } from "./_generated/server";
import type { ChatToolConnection } from "./appConnections";
import { createResourceAccess } from "./domain";

const { requireIdentity } = createResourceAccess("connected app tools");
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_REMOTE_MCP_TOOL_NAME_LENGTH = 256;
const MAX_REMOTE_MCP_INPUT_LENGTH = 1_000_000;
const MAX_TRACKER_QUERY_LENGTH = 10_000;
const MAX_TRACKER_ISSUE_KEY_LENGTH = 100;

const yandexTrackerIssueValidator = v.object({
	key: v.string(),
	summary: v.string(),
	status: v.optional(v.string()),
	assignee: v.optional(v.string()),
	url: v.string(),
});
const yandexTrackerSourceValidator = v.object({
	type: v.literal("url"),
	url: v.string(),
	title: v.string(),
});
const yandexTrackerSearchResultValidator = v.object({
	connection: v.string(),
	issues: v.array(yandexTrackerIssueValidator),
	sources: v.array(yandexTrackerSourceValidator),
});
const yandexTrackerIssueResultValidator = v.object({
	connection: v.string(),
	issue: yandexTrackerIssueValidator,
	sources: v.array(yandexTrackerSourceValidator),
});

type RemoteMcpChatToolConnection = Extract<
	ChatToolConnection,
	{ provider: RemoteMcpConnectionProvider }
>;
type YandexTrackerChatToolConnection = Extract<
	ChatToolConnection,
	{ provider: "yandex-tracker" }
>;

const isRemoteMcpChatToolConnection = (
	connection: ChatToolConnection,
): connection is RemoteMcpChatToolConnection =>
	isRemoteMcpConnectionProvider(connection.provider);

const authorizeConnectedAppToolRequest = async (ctx: ActionCtx) => {
	const identity = await requireIdentity(ctx);
	await ctx.runMutation(internal.connectedAppRateLimits.consumeToolRequest, {
		ownerTokenIdentifier: identity.tokenIdentifier,
	});
	return identity;
};

const getFreshChatToolConnection = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		sourceId: string;
	},
) => {
	if (
		!args.sourceId.startsWith(APP_SOURCE_PREFIX) ||
		args.sourceId.length > MAX_SOURCE_ID_LENGTH
	) {
		throw new ConvexError({
			code: "INVALID_APP_SOURCE",
			message: "Connected app source is invalid.",
		});
	}
	const connection = await ctx.runAction(
		internal.appConnectionActions.getChatToolConnectionInternalWithFreshToken,
		args,
	);
	if (!connection) {
		throw new ConvexError({
			code: "APP_CONNECTION_NOT_FOUND",
			message: "Connected app not found.",
		});
	}
	return connection;
};

const getRemoteMcpConnection = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		sourceId: string;
	},
) => {
	const connection = await getFreshChatToolConnection(ctx, args);
	if (!isRemoteMcpChatToolConnection(connection)) {
		throw new ConvexError({
			code: "APP_CONNECTION_NOT_SUPPORTED",
			message: "Connected app does not expose remote MCP tools.",
		});
	}
	return connection;
};

const getYandexTrackerConnection = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		sourceId: string;
	},
): Promise<YandexTrackerChatToolConnection> => {
	const connection = await getFreshChatToolConnection(ctx, args);
	if (connection.provider !== "yandex-tracker") {
		throw new ConvexError({
			code: "APP_CONNECTION_NOT_SUPPORTED",
			message: "Connected app is not Yandex Tracker.",
		});
	}
	return connection;
};

export const listRemoteMcpTools = action({
	args: {
		workspaceId: v.id("workspaces"),
		sourceId: v.string(),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		const identity = await authorizeConnectedAppToolRequest(ctx);
		const connection = await getRemoteMcpConnection(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			...args,
		});
		return await listRemoteMcpToolsForProxy(connection);
	},
});

export const executeRemoteMcpTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		sourceId: v.string(),
		toolName: v.string(),
		inputJson: v.string(),
	},
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		if (
			!args.toolName ||
			args.toolName.length > MAX_REMOTE_MCP_TOOL_NAME_LENGTH ||
			args.inputJson.length > MAX_REMOTE_MCP_INPUT_LENGTH
		) {
			throw new ConvexError({
				code: "INVALID_TOOL_INPUT",
				message: "Connected app tool input is invalid.",
			});
		}
		const identity = await authorizeConnectedAppToolRequest(ctx);
		const connection = await getRemoteMcpConnection(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			sourceId: args.sourceId,
		});
		return await executeRemoteMcpToolForProxy(connection, {
			inputJson: args.inputJson,
			toolName: args.toolName,
		});
	},
});

export const searchYandexTrackerIssuesForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		sourceId: v.string(),
		query: v.string(),
		limit: v.number(),
	},
	returns: yandexTrackerSearchResultValidator,
	handler: async (ctx, args) => {
		if (
			!args.query.trim() ||
			args.query.length > MAX_TRACKER_QUERY_LENGTH ||
			!Number.isInteger(args.limit) ||
			args.limit < 1 ||
			args.limit > 10
		) {
			throw new ConvexError({
				code: "INVALID_TOOL_INPUT",
				message: "Yandex Tracker search input is invalid.",
			});
		}
		const identity = await authorizeConnectedAppToolRequest(ctx);
		const connection = await getYandexTrackerConnection(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			sourceId: args.sourceId,
		});
		return await searchYandexTrackerIssues(connection, args.query, args.limit);
	},
});

export const getYandexTrackerIssueForTool = action({
	args: {
		workspaceId: v.id("workspaces"),
		sourceId: v.string(),
		issueKey: v.string(),
	},
	returns: yandexTrackerIssueResultValidator,
	handler: async (ctx, args) => {
		if (
			!args.issueKey.trim() ||
			args.issueKey.length > MAX_TRACKER_ISSUE_KEY_LENGTH
		) {
			throw new ConvexError({
				code: "INVALID_TOOL_INPUT",
				message: "Yandex Tracker issue key is invalid.",
			});
		}
		const identity = await authorizeConnectedAppToolRequest(ctx);
		const connection = await getYandexTrackerConnection(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			sourceId: args.sourceId,
		});
		return await getYandexTrackerIssue(connection, args.issueKey);
	},
});
