import type { ChatPluginSelection } from "@/lib/chat-plugin-prefill";
import type { WorkspaceRecord } from "@/lib/workspaces";

export type SettingsUser = {
	name: string;
	email: string;
	avatar: string;
};

export const SETTINGS_PAGES = [
	"Profile",
	"Appearance",
	"Voice",
	"Preferences",
	"Notifications",
	"Workspace",
	"Calendar",
	"Plugins",
	"Data controls",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

const settingsPageValues: ReadonlySet<string> = new Set(SETTINGS_PAGES);

export const isSettingsPage = (value: string): value is SettingsPage =>
	settingsPageValues.has(value);

export type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: SettingsUser;
	workspace: WorkspaceRecord | null;
	initialPage?: SettingsPage;
	onPageChange?: (page: SettingsPage) => void;
	onTryPlugin: (plugin: ChatPluginSelection) => void;
};
