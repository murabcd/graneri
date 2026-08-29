import { CHAT_MODE } from "@workspace/ai/chat-mode";
import {
	GPT_5_6_LUNA_MODEL_ID,
	GPT_5_6_SOL_MODEL_ID,
	GPT_5_6_TERRA_MODEL_ID,
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
	v.literal(GPT_5_6_SOL_MODEL_ID),
	v.literal(GPT_5_6_TERRA_MODEL_ID),
	v.literal(GPT_5_6_LUNA_MODEL_ID),
);

export const chatSettingsFields = {
	chatMode: chatModeValidator,
	model: chatModelValidator,
	reasoningEffort: reasoningEffortValidator,
	serviceTier: serviceTierValidator,
	webSearchEnabled: v.boolean(),
};

export const chatSettingsValidator = v.object(chatSettingsFields);

export type ChatSettings = Infer<typeof chatSettingsValidator>;
