import type { ChatComposerMention } from "@/lib/chat-composer-mentions";
import {
	type ChatAppSourceProvider,
	getAppSourceLabel,
} from "@/lib/chat-source-display";

export type ChatPluginSelection = {
	provider: ChatAppSourceProvider;
	sourceId: string;
};

export type ChatPluginPrefill = ChatPluginSelection & {
	composerId: string;
};

export const consumeChatPluginPrefill = ({
	chatId,
	prefill,
}: {
	chatId: string;
	prefill: ChatPluginPrefill | null;
}): ChatPluginPrefill | null =>
	prefill?.composerId === chatId ? null : prefill;

export const createChatPluginDraft = ({
	provider,
	sourceId,
}: ChatPluginSelection): {
	text: string;
	metadata: { mentions: ChatComposerMention[] };
} => {
	const label = getAppSourceLabel(provider);
	const mentionText = `@${label}`;

	return {
		text: `${mentionText} `,
		metadata: {
			mentions: [
				{
					id: sourceId,
					label,
					from: 0,
					to: mentionText.length,
					type: "tool",
					provider,
				},
			],
		},
	};
};
