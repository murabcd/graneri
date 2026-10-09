import { CHAT_MODE } from "@workspace/ai/chat-mode";
import {
	GPT_6_ASTRA_MODEL_ID,
	GPT_6_LUNA_MODEL_ID,
	GPT_6_SOL_MODEL_ID,
} from "@workspace/ai/models";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
	reasoningEffortValidator,
	serviceTierValidator,
} from "./assistantRunModel";

export const chatModeValidator = v.union(
	v.literal(CHAT_MODE.DEFAULT),
	v.literal(CHAT_MODE.PLAN),
);

export const chatModelValidator = v.union(
	v.literal(GPT_6_SOL_MODEL_ID),
	v.literal(GPT_6_ASTRA_MODEL_ID),
	v.literal(GPT_6_LUNA_MODEL_ID),
);

export const chatSettingsFields = {
	chatMode: chatModeValidator,
	model: chatModelValidator,
	reasoningEffort: reasoningEffortValidator,
	serviceTier: serviceTierValidator,
	webSearchEnabled: v.boolean(),
};

export const chatSettingsValidator = v.object(chatSettingsFields);

export const storedChatSettingsFields = {
	...chatSettingsFields,
	model: v.union(
		chatModelValidator,
		v.literal("gpt-5.6-sol"),
		v.literal("gpt-5.6-terra"),
		v.literal("gpt-5.6-luna"),
	),
};

export type ChatSettings = Infer<typeof chatSettingsValidator>;
