"use node";

import { getSelectedAppSourceIds } from "@workspace/ai/capability-metadata";
import {
	buildCapabilityToolSet,
	type WorkspaceToolConnection,
} from "@workspace/ai/capability-registry";
import { buildMeetingTools } from "@workspace/ai/meeting-tools";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { listYandexUpcomingEvents } from "./yandexCalendar";

const buildYandexCalendarAdapter =
	() =>
	(connection: {
		displayName: string;
		email: string;
		password: string;
		serverAddress: string;
		calendarHomePath: string;
	}) => ({
		listUpcomingEvents: async ({ lookaheadMs }: { lookaheadMs: number }) => {
			const now = Date.now();
			const result = await listYandexUpcomingEvents({
				connection,
				now,
				timeMin: now,
				timeMax: now + lookaheadMs,
			});

			return {
				connection: connection.displayName,
				events: result.events,
			};
		},
	});

export const buildServerWorkspaceTools = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
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
	const sourceIds = getSelectedAppSourceIds(args.selectedSourceIds);
	if (sourceIds.length === 0) {
		return {
			connections: [] as WorkspaceToolConnection[],
			tools: meetingTools,
		};
	}

	const connections = (await ctx.runAction(
		internal.appConnectionActions.getSelectedForChatInternalWithFreshTokens,
		{
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			sourceIds,
		},
	)) as WorkspaceToolConnection[];
	const tools = await buildCapabilityToolSet(connections, {
		yandexCalendar: buildYandexCalendarAdapter(),
	});

	return { connections, tools: { ...meetingTools, ...tools } };
};
