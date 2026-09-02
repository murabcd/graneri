import { isDesktopRuntime } from "@workspace/platform/desktop";
import * as React from "react";
import type { SettingsPage } from "@/components/settings/settings-types";
import type { WorkspaceRecord } from "@/lib/workspaces";
import type { Id } from "../../../../convex/_generated/dataModel";

const useDesktopSettingsShortcut = (
	handleSettingsOpenChange: (open: boolean, page?: SettingsPage) => void,
) => {
	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key !== "," && event.code !== "Comma")
			)
				return;
			event.preventDefault();
			handleSettingsOpenChange(true, "Profile");
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSettingsOpenChange]);
};

const useDesktopWorkspaceShortcut = ({
	activeWorkspaceId,
	onWorkspaceSelect,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	workspaces: WorkspaceRecord[];
}) => {
	React.useEffect(() => {
		if (typeof window === "undefined" || !isDesktopRuntime()) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				!/^[1-9]$/.test(event.key)
			)
				return;
			const workspace = workspaces[Number(event.key) - 1];
			if (!workspace || workspace._id === activeWorkspaceId) return;
			event.preventDefault();
			onWorkspaceSelect(workspace._id);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeWorkspaceId, onWorkspaceSelect, workspaces]);
};

export const useAppShellDesktopShortcuts = ({
	activeWorkspaceId,
	handleSettingsOpenChange,
	onWorkspaceSelect,
	workspaces,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	handleSettingsOpenChange: (open: boolean, page?: SettingsPage) => void;
	onWorkspaceSelect: (workspaceId: Id<"workspaces">) => void;
	workspaces: WorkspaceRecord[];
}) => {
	useDesktopSettingsShortcut(handleSettingsOpenChange);
	useDesktopWorkspaceShortcut({
		activeWorkspaceId,
		onWorkspaceSelect,
		workspaces,
	});
};
