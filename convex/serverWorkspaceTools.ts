"use node";

import { selectAppSourceConnections } from "@workspace/ai/capability-metadata";
import {
	buildCapabilityToolSet,
	type WorkspaceToolConnection,
} from "@workspace/ai/capability-registry";
import { buildMeetingTools } from "@workspace/ai/meeting-tools";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type { AppToolScope } from "./assistantRunJobModel";
import { createCalendarCapabilityAdapter } from "./calendar";
import {
	getGoogleAccessToken,
	getGoogleAuthContextForUser,
} from "./googleAuth";
import {
	getAvailableGoogleToolSources,
	getGoogleDriveFile,
	searchGoogleDriveFiles,
} from "./googleTools";

const hasConnection = (
	connections: WorkspaceToolConnection[],
	provider: WorkspaceToolConnection["provider"],
) => connections.some((connection) => connection.provider === provider);

const loadGoogleToolConnections = async (
	ctx: ActionCtx,
	args: {
		googleAuthUserId: string | null;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
	},
) => {
	if (!args.googleAuthUserId) {
		return { authContext: null, connections: [] };
	}

	const preferences = await ctx.runQuery(
		internal.calendarPreferences.getForOwner,
		{
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		},
	);
	if (!preferences.showGoogleCalendar && !preferences.showGoogleDrive) {
		return { authContext: null, connections: [] };
	}

	const authContext = getGoogleAuthContextForUser(ctx, args.googleAuthUserId);
	const tokens = await getGoogleAccessToken(authContext);
	if (!tokens) {
		return { authContext: null, connections: [] };
	}

	const connections: WorkspaceToolConnection[] = getAvailableGoogleToolSources({
		preferences,
		scopes: tokens.scopes,
	});

	return { authContext, connections };
};

export const buildServerWorkspaceTools = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		googleAuthUserId: string | null;
		appToolScope: AppToolScope;
		selectedSourceIds: string[];
	},
) => {
	const meetingTools = buildMeetingTools({
		searchMeetings: async ({ query, from, to, limit }) =>
			await ctx.runQuery(
				internal.meetingRelationships.searchMeetingNotesInternal,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					query,
					...(from ? { from } : {}),
					...(to ? { to } : {}),
					...(typeof limit === "number" ? { limit } : {}),
				},
			),
	});
	if (args.appToolScope === "disabled") {
		return {
			selectedConnections: [],
			tools: meetingTools,
		};
	}

	const [serverResult, googleResult] = await Promise.allSettled([
		ctx.runAction(
			internal.appConnectionActions.getForChatInternalWithFreshTokens,
			{
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
			},
		),
		loadGoogleToolConnections(ctx, args),
	]);
	if (serverResult.status === "rejected") {
		console.error(
			"Connected chat sources could not be loaded for a durable run.",
			serverResult.reason,
		);
	}
	if (googleResult.status === "rejected") {
		console.error(
			"Google chat sources could not be loaded for a durable run.",
			googleResult.reason,
		);
	}
	const serverConnections =
		serverResult.status === "fulfilled" ? serverResult.value : [];
	const google =
		googleResult.status === "fulfilled"
			? googleResult.value
			: { authContext: null, connections: [] };
	const connections: WorkspaceToolConnection[] = [
		...serverConnections,
		...google.connections,
	];
	const selectedConnections = selectAppSourceConnections(
		connections,
		args.selectedSourceIds,
	);
	const toolConnections =
		args.appToolScope === "available" ? connections : selectedConnections;
	const yandexCalendarConnection = toolConnections.find(
		(connection) => connection.provider === "yandex-calendar",
	);
	const tools = await buildCapabilityToolSet(toolConnections, {
		...(google.authContext && hasConnection(toolConnections, "google-calendar")
			? {
					googleCalendar: createCalendarCapabilityAdapter({
						ctx,
						providerInput: {
							provider: "google",
							googleAuthContext: google.authContext,
						},
					}),
				}
			: {}),
		...(google.authContext && hasConnection(toolConnections, "google-drive")
			? {
					googleDrive: {
						searchFiles: async ({ query, limit }) =>
							await searchGoogleDriveFiles({
								authContext: google.authContext,
								query,
								limit,
							}),
						getFile: async ({ fileId }) =>
							await getGoogleDriveFile({
								authContext: google.authContext,
								fileId,
							}),
					},
				}
			: {}),
		...(yandexCalendarConnection
			? {
					yandexCalendar: createCalendarCapabilityAdapter({
						ctx,
						providerInput: {
							provider: "yandex",
							connection: yandexCalendarConnection,
						},
					}),
				}
			: {}),
	});

	return {
		selectedConnections,
		tools: { ...meetingTools, ...tools },
	};
};
