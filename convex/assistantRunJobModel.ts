import { type Infer, v } from "convex/values";
import { reasoningEffortValidator } from "./assistantRunModel";

export const assistantRunJobValidator = v.object({
	messagesJson: v.string(),
	systemPrompt: v.string(),
	webSearchEnabled: v.boolean(),
	chartGenerationRequested: v.boolean(),
	imageGenerationRequested: v.boolean(),
	shouldGenerateChatTitle: v.optional(v.boolean()),
	selectedSourceIds: v.array(v.string()),
	defaultTimezone: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
});

export type AssistantRunJob = Infer<typeof assistantRunJobValidator>;
