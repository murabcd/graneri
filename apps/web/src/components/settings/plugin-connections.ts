import type React from "react";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";

export const pluginGroups = [
	"Productivity",
	"Tracking",
	"Knowledge",
	"Design",
	"Analytics",
	"Meetings",
] as const;

export type PluginGroup = (typeof pluginGroups)[number];

type PluginInstallation =
	| { status: "available" }
	| {
			status: "installed";
			sourceId: string;
			provider: ChatAppSourceProvider;
			onUninstall?: () => void;
	  };

export type ToolConnection = {
	group: PluginGroup;
	icon: React.ReactNode;
	name: string;
	buttonDisabled?: boolean;
	buttonIcon?: React.ReactNode;
	installation: PluginInstallation;
	onConfigure: () => void;
};
