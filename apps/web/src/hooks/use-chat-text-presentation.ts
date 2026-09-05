import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createChatTextPresentation } from "@/lib/chat-text-presentation";

export const useChatTextPresentation = (text: string, isStreaming: boolean) => {
	const [presentation] = useState(() =>
		createChatTextPresentation(text, isStreaming),
	);
	useLayoutEffect(() => {
		presentation.update(text, isStreaming);
	}, [presentation, text, isStreaming]);
	return useSyncExternalStore(
		presentation.subscribe,
		presentation.getSnapshot,
		presentation.getSnapshot,
	);
};
