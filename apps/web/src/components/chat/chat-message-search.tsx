import { useMessageScroller } from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import * as React from "react";
import { getChatText } from "@/lib/chat-message";
import { groupMessagesIntoTurns } from "@/lib/chat-turns";
import { escapeRegExp } from "@/lib/text-search-ranges";

type ChatSearchMatch = {
	messageId: string;
	scrollerId: string;
	text: string;
};

export const getChatSearchMatches = (messages: UIMessage[], query: string) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	const matches: ChatSearchMatch[] = [];
	const matcher = new RegExp(escapeRegExp(normalizedQuery), "u");

	for (const turnMessages of groupMessagesIntoTurns(messages)) {
		const scrollerId = turnMessages[0].id;

		for (const message of turnMessages) {
			const text = getChatText(message);
			if (matcher.test(text.toLocaleLowerCase())) {
				matches.push({
					messageId: message.id,
					scrollerId,
					text,
				});
			}
		}
	}

	return matches;
};

export function ChatMessageSearchNavigator({
	scrollerId,
}: {
	scrollerId: string | null;
}) {
	const { scrollToMessage } = useMessageScroller();

	React.useEffect(() => {
		if (!scrollerId) {
			return;
		}

		scrollToMessage(scrollerId, {
			align: "center",
			behavior: "smooth",
		});
	}, [scrollToMessage, scrollerId]);

	return null;
}
