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
