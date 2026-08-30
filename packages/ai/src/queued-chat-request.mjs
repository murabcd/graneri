import { z } from "zod";
import { CHAT_MODES } from "./chat-mode.mjs";
import { localCapabilitySessionSchema } from "./local-capability-session.mjs";

const queuedNoteContextSchema = z.union([
	z.strictObject({ noteId: z.string().min(1) }),
	z.strictObject({
		noteId: z.null(),
		text: z.string(),
		title: z.string(),
	}),
]);

const durableQueuedChatRequestSchema = z.strictObject({
	chatMode: z.enum(CHAT_MODES),
	localCapabilitySession: localCapabilitySessionSchema.nullable(),
	mentions: z.array(z.string()).optional(),
	model: z.string().min(1),
	noteContext: queuedNoteContextSchema.optional(),
	projectId: z.string().min(1).nullable(),
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
	recipeSlug: z.string().nullable().optional(),
	selectedSourceIds: z.array(z.string()).optional(),
	serviceTier: z.enum(["auto", "priority"]),
	timezone: z.string().min(1),
	webSearchEnabled: z.boolean(),
});

export const parseDurableQueuedChatRequest = (value) => {
	const result = durableQueuedChatRequestSchema.safeParse(value);
	return result.success ? result.data : null;
};
