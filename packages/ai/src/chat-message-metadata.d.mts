import type { ChatAppSourceProvider } from "./capability-metadata.mjs";

type ChatMessageMentionBase = {
	from: number;
	id: string;
	label: string;
	to: number;
};

export type ChatMessageMention =
	| (ChatMessageMentionBase & { type: "note" })
	| (ChatMessageMentionBase & {
			provider: ChatAppSourceProvider;
			type: "tool";
	  });

export type ChatRecipeReceipt = {
	name: string;
	slug: string;
};

export type ChatMessageMetadata = {
	interrupted?: boolean;
	workDurationMs?: number;
	mentionPositions?: ChatMessageMention[];
} & (
	| { recipe: ChatRecipeReceipt; recipeOnly: boolean }
	| { recipe?: never; recipeOnly?: never }
);

export declare const parseChatMessageMetadata: (
	value: unknown,
) => ChatMessageMetadata | null;

export declare const encodeChatMessageWorkDuration: (input: {
	metadataJson?: string;
	startedAt: number;
	completedAt: number;
}) => string;
