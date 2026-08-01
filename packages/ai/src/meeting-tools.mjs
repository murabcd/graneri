import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

export const buildMeetingToolDefinitions = ({ searchMeetings }) => [
	defineAiTool({
		name: "search_meetings",
		description:
			"Search Graneri calendar-linked meeting notes by person name, email, company name, or business email domain. Use this whenever the user asks for meetings with someone or a company, their next linked meeting, relationship history, or a summary from a dated meeting. Results can include past and future linked meetings and include note text plus schedule details. If hasMore or searchableTextTruncated is true, call again with a narrower ISO date window before claiming a complete history or summary.",
		inputSchema: z.object({
			query: z.string().min(1).max(320),
			from: z.string().min(1).optional(),
			to: z.string().min(1).optional(),
			limit: z.number().int().min(1).max(25).optional(),
		}),
		policy: {
			access: "read",
			capability: "search",
			provider: "graneri-meetings",
			requiresConnection: false,
		},
		ui: toolUiMetadata.search_meetings,
		execute: async (input) => await searchMeetings(input),
	}),
];

export const buildMeetingTools = (args) =>
	buildAiToolSet(buildMeetingToolDefinitions(args));
