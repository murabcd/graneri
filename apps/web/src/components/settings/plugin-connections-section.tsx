import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field } from "@workspace/ui/components/field";
import { Label } from "@workspace/ui/components/label";
import { MessageCircle, MoreHorizontal, Settings2, Trash2 } from "lucide-react";
import {
	pluginGroups,
	type ToolConnection,
} from "@/components/settings/plugin-connections";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";

export function PluginConnectionsSection({
	connections,
	onTryNow,
}: {
	connections: ToolConnection[];
	onTryNow: (plugin: {
		provider: ChatAppSourceProvider;
		sourceId: string;
	}) => void;
}) {
	return (
		<Field>
			<div className="space-y-6">
				{pluginGroups.map((group) => {
					const groupConnections = connections.filter(
						(connection) => connection.group === group,
					);

					if (groupConnections.length === 0) {
						return null;
					}

					return (
						<div key={group} className="space-y-3">
							<Label className="text-xs font-medium text-muted-foreground">
								{group}
							</Label>
							<div className="space-y-3">
								{groupConnections.map((connection) => (
									<PluginConnectionRow
										key={connection.name}
										connection={connection}
										onTryNow={onTryNow}
									/>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</Field>
	);
}

function PluginConnectionRow({
	connection,
	onTryNow,
}: {
	connection: ToolConnection;
	onTryNow: (plugin: {
		provider: ChatAppSourceProvider;
		sourceId: string;
	}) => void;
}) {
	const installed =
		connection.installation.status === "installed"
			? connection.installation
			: null;

	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-3">
				{connection.icon}
				<Label className="min-w-0 text-sm font-medium text-foreground">
					{connection.name}
				</Label>
			</div>
			{installed ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={`Options for ${connection.name}`}
							disabled={connection.buttonDisabled}
						>
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem
							onClick={() =>
								onTryNow({
									provider: installed.provider,
									sourceId: installed.sourceId,
								})
							}
						>
							<MessageCircle />
							Try now
						</DropdownMenuItem>
						<DropdownMenuItem onClick={connection.onConfigure}>
							<Settings2 />
							Manage
						</DropdownMenuItem>
						{installed.onUninstall ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={installed.onUninstall}
								>
									<Trash2 />
									Uninstall
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<Button
					type="button"
					variant="outline"
					size="default"
					onClick={connection.onConfigure}
					disabled={connection.buttonDisabled}
				>
					{connection.buttonIcon}
					Install
				</Button>
			)}
		</div>
	);
}
