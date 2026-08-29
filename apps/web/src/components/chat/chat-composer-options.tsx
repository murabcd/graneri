import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";
import { isDesktopRuntime } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { Switch } from "@workspace/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	Folder,
	FolderPlus,
	Globe,
	Lightbulb,
	Plus,
	Settings2,
} from "lucide-react";
import { ActiveComposerOption } from "@/components/ai-elements/active-composer-option";
import { HoverScrollTitle } from "@/components/hover-scroll-title";

type ChatComposerOptionsProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	chatMode: ChatMode;
	onChatModeChange: (mode: ChatMode) => void;
	localFolder: DesktopLocalFolder | null;
	onChooseLocalFolder: () => void;
	onClearLocalFolder: () => void;
	onOpenConnectionsSettings: () => void;
};

export function ChatComposerOptions({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	chatMode,
	onChatModeChange,
	localFolder,
	onChooseLocalFolder,
	onClearLocalFolder,
	onOpenConnectionsSettings,
}: ChatComposerOptionsProps) {
	return (
		<>
			<ScopePicker
				open={open}
				onOpenChange={onOpenChange}
				webSearchEnabled={webSearchEnabled}
				onWebSearchEnabledChange={onWebSearchEnabledChange}
				chatMode={chatMode}
				onChatModeChange={onChatModeChange}
				localFolder={localFolder}
				onChooseLocalFolder={onChooseLocalFolder}
				onClearLocalFolder={onClearLocalFolder}
				onOpenConnectionsSettings={onOpenConnectionsSettings}
			/>
			{webSearchEnabled ? (
				<ActiveComposerOption
					disableLabel="Turn off Web search"
					icon={Globe}
					label="Web"
					onDisable={() => onWebSearchEnabledChange(false)}
				/>
			) : null}
			{chatMode === CHAT_MODE.PLAN ? (
				<ActiveComposerOption
					disableLabel="Turn off Plan mode"
					icon={Lightbulb}
					label="Plan"
					onDisable={() => onChatModeChange(CHAT_MODE.DEFAULT)}
				/>
			) : null}
			{localFolder ? (
				<ActiveComposerOption
					disableLabel={`Remove ${localFolder.name}`}
					icon={Folder}
					label={
						<HoverScrollTitle className="max-w-28" scrollOnHover={false}>
							{localFolder.name}
						</HoverScrollTitle>
					}
					labelClassName="min-w-0"
					onDisable={onClearLocalFolder}
					tooltipLabel={`Remove ${localFolder.path}`}
				/>
			) : null}
		</>
	);
}

function ScopePicker({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	chatMode,
	onChatModeChange,
	localFolder,
	onChooseLocalFolder,
	onOpenConnectionsSettings,
}: ChatComposerOptionsProps) {
	const canSelectLocalFolders = isDesktopRuntime();

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							aria-label="Chat options"
							size="icon-sm"
							className="group rounded-full"
						>
							<Settings2 className="text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground" />
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Chat options</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				side="bottom"
				align="start"
				sideOffset={4}
				className="w-56"
			>
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="web-search">
							<Globe className="text-foreground" /> Web search
							<Switch
								id="web-search"
								className="ml-auto"
								checked={webSearchEnabled}
								onCheckedChange={onWebSearchEnabledChange}
							/>
						</label>
					</DropdownMenuItem>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="plan-mode">
							<Lightbulb className="text-foreground" /> Plan mode
							<Switch
								id="plan-mode"
								className="ml-auto"
								checked={chatMode === CHAT_MODE.PLAN}
								onCheckedChange={(enabled) =>
									onChatModeChange(enabled ? CHAT_MODE.PLAN : CHAT_MODE.DEFAULT)
								}
							/>
						</label>
					</DropdownMenuItem>
					{canSelectLocalFolders ? (
						<DropdownMenuItem onSelect={onChooseLocalFolder}>
							<FolderPlus className="text-foreground" />
							<span>
								{localFolder ? "Change local folder" : "Add local folder"}
							</span>
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						aria-label="Connect plugins"
						onClick={onOpenConnectionsSettings}
					>
						<Plus aria-hidden="true" />
						<span>Connect plugins</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
