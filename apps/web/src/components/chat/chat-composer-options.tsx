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
import { Database, Globe, Lightbulb, Plus, Settings2 } from "lucide-react";
import { ActiveComposerOption } from "@/components/ai-elements/active-composer-option";
import {
	ActiveComposerProjectOption,
	type ComposerProjectOption,
	ComposerProjectPicker,
} from "@/components/ai-elements/composer-project-picker";
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
	projects: ComposerProjectOption[];
	projectsStatus: "loading" | "ready";
	selectedProject: ComposerProjectOption | null;
	onSelectedProjectChange: (project: ComposerProjectOption | null) => void;
	onOpenConnectionsSettings: () => void;
};

type ScopePickerProps = Pick<
	ChatComposerOptionsProps,
	| "chatMode"
	| "localFolder"
	| "onChatModeChange"
	| "onChooseLocalFolder"
	| "onOpenChange"
	| "onOpenConnectionsSettings"
	| "onSelectedProjectChange"
	| "onWebSearchEnabledChange"
	| "open"
	| "projects"
	| "projectsStatus"
	| "selectedProject"
	| "webSearchEnabled"
>;

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
	projects,
	projectsStatus,
	selectedProject,
	onSelectedProjectChange,
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
				projects={projects}
				projectsStatus={projectsStatus}
				selectedProject={selectedProject}
				onSelectedProjectChange={onSelectedProjectChange}
				onOpenConnectionsSettings={onOpenConnectionsSettings}
			/>
			{webSearchEnabled ? (
				<ActiveComposerOption
					disableLabel="Turn off Web search"
					icon={<Globe aria-hidden="true" />}
					label="Web"
					onDisable={() => onWebSearchEnabledChange(false)}
				/>
			) : null}
			{chatMode === CHAT_MODE.PLAN ? (
				<ActiveComposerOption
					disableLabel="Turn off Plan mode"
					icon={<Lightbulb aria-hidden="true" />}
					label="Plan"
					onDisable={() => onChatModeChange(CHAT_MODE.DEFAULT)}
				/>
			) : null}
			{selectedProject ? (
				<ActiveComposerProjectOption
					project={selectedProject}
					onRemove={() => onSelectedProjectChange(null)}
				/>
			) : null}
			{localFolder ? (
				<ActiveComposerOption
					disableLabel={`Remove ${localFolder.name}`}
					icon={<Database aria-hidden="true" />}
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
	projects,
	projectsStatus,
	selectedProject,
	onSelectedProjectChange,
	onOpenConnectionsSettings,
}: ScopePickerProps) {
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
					<ComposerProjectPicker
						projects={projects}
						projectsStatus={projectsStatus}
						selectedProject={selectedProject}
						onSelectedProjectChange={(project) => {
							onSelectedProjectChange(project);
							onOpenChange(false);
						}}
					/>
					{canSelectLocalFolders ? (
						<DropdownMenuItem onSelect={onChooseLocalFolder}>
							<Database className="text-foreground" />
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
