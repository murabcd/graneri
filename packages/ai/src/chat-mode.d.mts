export declare const CHAT_MODE: Readonly<{
	DEFAULT: "default";
	PLAN: "plan";
}>;

export type ChatMode = (typeof CHAT_MODE)[keyof typeof CHAT_MODE];

export declare const CHAT_MODES: readonly ["default", "plan"];

export declare const parseChatMode: (value: unknown) => ChatMode | null;

export declare const getChatModeInstructions: (chatMode: ChatMode) => string;
