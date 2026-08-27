import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const buildMeetingToolDefinitions = ({ searchMeetings }) => [
	defineAiTool({
		name: "search_meeting_notes",
		description:
			"Search saved Graneri meeting notes by person name, email, company name, or business email domain. Use this for relationship history, previous meeting notes, or a summary from a dated meeting. This is not the authoritative source for current or future schedules; when a connected calendar tool is available, use that provider's list or search tool for upcoming events. If hasMore or searchableTextTruncated is true, call again with a narrower ISO date window before claiming a complete history or summary.",
		inputSchema: z.object({
			query: z.string().min(1).max(320),
			from: z.string().min(1).optional(),
			to: z.string().min(1).optional(),
			limit: z.number().int().min(1).max(25).optional(),
		}),
		policy: {
			access: "read",
			approval: "not_required",
			capability: "search",
			provider: "graneri-meetings",
			requiresConnection: false,
		},
		ui: toolUiMetadata.search_meeting_notes,
		execute: async (input) => await searchMeetings(input),
	}),
];

export const buildMeetingTools = (args) =>
	buildAiToolSet(buildMeetingToolDefinitions(args));
