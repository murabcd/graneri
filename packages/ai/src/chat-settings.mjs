import { z } from "zod";
import { CHAT_MODE, CHAT_MODES } from "./chat-mode.mjs";
import {
	DEFAULT_CHAT_MODEL_ID,
	DEFAULT_REASONING_EFFORT,
	DEFAULT_SERVICE_TIER,
	isSupportedChatModel,
} from "./models.mjs";

const chatSettingsSchema = z.strictObject({
	chatMode: z.enum(CHAT_MODES),
	model: z.string().refine(isSupportedChatModel),
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
	serviceTier: z.enum(["auto", "priority"]),
	webSearchEnabled: z.boolean(),
});

export const DEFAULT_CHAT_SETTINGS = Object.freeze({
	chatMode: CHAT_MODE.DEFAULT,
	model: DEFAULT_CHAT_MODEL_ID,
	reasoningEffort: DEFAULT_REASONING_EFFORT,
	serviceTier: DEFAULT_SERVICE_TIER,
	webSearchEnabled: false,
});

export const parseChatSettings = (value) => {
	const result = chatSettingsSchema.safeParse(value);
	return result.success ? result.data : null;
};
