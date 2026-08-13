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
import { Globe, Plus, Settings2 } from "lucide-react";

export function AppSourcesPicker({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	onOpenConnectionsSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	onOpenConnectionsSettings: () => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							type="button"
							variant="ghost"
							size="icon-sm"
							className="group/automation-picker rounded-full text-muted-foreground"
							aria-label="Select scope"
						>
							<Settings2 className="size-4 shrink-0 text-muted-foreground group-hover/automation-picker:text-foreground group-focus-visible/automation-picker:text-foreground group-data-[state=open]/automation-picker:text-foreground" />
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Select scope</TooltipContent>
			</Tooltip>
			<DropdownMenuContent side="bottom" align="start" className="w-64">
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="automation-web-search">
							<Globe className="text-foreground" /> Web search
							<Switch
								id="automation-web-search"
								className="ml-auto"
								checked={webSearchEnabled}
								onCheckedChange={onWebSearchEnabledChange}
							/>
						</label>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						aria-label="Connect apps"
						onClick={onOpenConnectionsSettings}
					>
						<Plus aria-hidden="true" />
						<span aria-hidden="true">Connect plugins</span>
						<span className="sr-only">Connect apps</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
