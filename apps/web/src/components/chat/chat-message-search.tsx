import { useMessageScroller } from "@workspace/ui/components/message-scroller";
import * as React from "react";

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
