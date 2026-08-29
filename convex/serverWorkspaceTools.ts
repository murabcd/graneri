"use node";

import type {
	GraneriCapabilityAdapters,
	WorkspaceToolConnection,
	YandexCalendarToolConnection,
} from "@workspace/ai/capability-registry";
import { buildMeetingTools } from "@workspace/ai/meeting-tools";
import { buildProjectNoteTools } from "@workspace/ai/project-note-tools";
import {
	buildWorkspaceToolCatalog,
	loadWorkspaceToolConnections,
} from "@workspace/ai/workspace-tool-catalog";
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

const isYandexCalendarToolConnection = (
	connection: WorkspaceToolConnection,
): connection is YandexCalendarToolConnection =>
	connection.provider === "yandex-calendar" && "password" in connection;

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
		chatId: string;
		googleAuthUserId: string | null;
		appToolScope: AppToolScope;
		selectedSourceIds: string[];
	},
) => {
	const projectNoteTools = buildProjectNoteTools({
		searchProjectNotes: async ({ query: searchQuery, limit }) => {
			const queryArgs = {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: args.chatId,
				searchQuery,
			};
			const result =
				limit === undefined
					? await ctx.runQuery(
							internal.chatProjectNotes.searchForOwner,
							queryArgs,
						)
					: await ctx.runQuery(internal.chatProjectNotes.searchForOwner, {
							...queryArgs,
							limit,
						});
			return {
				hasMore: result.hasMore,
				notes: result.notes.map((note) => ({
					noteId: note.id,
					title: note.title,
					preview: note.preview,
					updatedAt: note.updatedAt,
				})),
			};
		},
		getProjectNote: async ({ noteId, offset }) => {
			const note = await ctx.runQuery(internal.chatProjectNotes.getForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: args.chatId,
				noteId,
				...(typeof offset === "number" && { offset }),
			});
			return note
				? {
						noteId: note.id,
						nextOffset: note.nextOffset,
						title: note.title,
						text: note.text,
						updatedAt: note.updatedAt,
					}
				: null;
		},
	});
	const meetingTools = buildMeetingTools({
		searchMeetings: async ({ query, from, to, limit }) =>
			await ctx.runQuery(
				internal.meetingRelationships.searchMeetingNotesInternal,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					query,
					...(from && { from }),
					...(to && { to }),
					...(typeof limit === "number" && { limit }),
				},
			),
	});
	let googleAuthContext: Awaited<
		ReturnType<typeof loadGoogleToolConnections>
	>["authContext"] = null;
	const connections =
		args.appToolScope === "disabled"
			? []
			: await loadWorkspaceToolConnections([
					{
						label: "Connected app",
						load: async () =>
							await ctx.runAction(
								internal.appConnectionActions.getForChatInternalWithFreshTokens,
								{
									ownerTokenIdentifier: args.ownerTokenIdentifier,
									workspaceId: args.workspaceId,
								},
							),
					},
					{
						label: "Google",
						load: async () => {
							const google = await loadGoogleToolConnections(ctx, args);
							googleAuthContext = google.authContext;
							return google.connections;
						},
					},
				]);
	const yandexCalendarConnection = connections.find(
		isYandexCalendarToolConnection,
	);
	const activeGoogleAuthContext = googleAuthContext;
	const googleCalendarAdapter: GraneriCapabilityAdapters["googleCalendar"] =
		activeGoogleAuthContext && hasConnection(connections, "google-calendar")
			? createCalendarCapabilityAdapter({
					ctx,
					providerInput: {
						provider: "google",
						googleAuthContext: activeGoogleAuthContext,
					},
				})
			: undefined;
	const googleDriveAdapter: GraneriCapabilityAdapters["googleDrive"] =
		activeGoogleAuthContext && hasConnection(connections, "google-drive")
			? {
					searchFiles: async ({ query, limit }) =>
						await searchGoogleDriveFiles({
							authContext: activeGoogleAuthContext,
							query,
							limit,
						}),
					getFile: async ({ fileId }) =>
						await getGoogleDriveFile({
							authContext: activeGoogleAuthContext,
							fileId,
						}),
				}
			: undefined;
	const catalog = await buildWorkspaceToolCatalog({
		builtInTools: { ...meetingTools, ...projectNoteTools },
		connections,
		scope: args.appToolScope,
		selectedSourceIds: args.selectedSourceIds,
		adapters: {
			...(googleCalendarAdapter && { googleCalendar: googleCalendarAdapter }),
			...(googleDriveAdapter && { googleDrive: googleDriveAdapter }),
			...(yandexCalendarConnection && {
				yandexCalendar: createCalendarCapabilityAdapter({
					ctx,
					providerInput: {
						provider: "yandex",
						connection: yandexCalendarConnection,
					},
				}),
			}),
		},
	});

	return {
		selectedConnections: catalog.selectedConnections,
		tools: catalog.tools,
	};
};
