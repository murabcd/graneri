import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";
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
import { Globe, Lightbulb, Plus, Settings2 } from "lucide-react";
import { ActiveComposerOption } from "@/components/ai-elements/active-composer-option";

type ChatComposerOptionsProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	chatMode: ChatMode;
	onChatModeChange: (mode: ChatMode) => void;
	onOpenConnectionsSettings: () => void;
};

export function ChatComposerOptions({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	chatMode,
	onChatModeChange,
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
	onOpenConnectionsSettings,
}: ChatComposerOptionsProps) {
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
