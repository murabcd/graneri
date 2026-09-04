import {
	type ApplicationShortcutKeyBindingId,
	matchesApplicationShortcut,
} from "@workspace/platform/application-shortcuts";
import * as React from "react";

export const useApplicationShortcut = (
	shortcutId: ApplicationShortcutKeyBindingId,
	handler: () => void,
) => {
	const handleShortcut = React.useEffectEvent(handler);

	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!matchesApplicationShortcut(event, shortcutId)) {
				return;
			}

			event.preventDefault();
			handleShortcut();
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [shortcutId]);
};
