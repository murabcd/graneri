import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Minus } from "lucide-react";
import { DockedPanelPinButton } from "@/components/layout/docked-side-panel";

export function CalendarEventPanelHeader({
	closeLabel,
	desktopSafeTop,
	isMobile,
	isPinned,
	onClose,
	onTogglePinned,
	title,
}: {
	closeLabel: string;
	desktopSafeTop: boolean;
	isMobile: boolean;
	isPinned: boolean;
	onClose: () => void;
	onTogglePinned: () => void;
	title: string;
}) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-between",
				desktopSafeTop ? "h-10 px-2" : isMobile ? "h-16 px-4" : "h-12 px-4",
			)}
		>
			<h2 className="min-w-0 truncate text-sm">{title}</h2>
			<div className="flex items-center gap-1">
				{isMobile ? null : (
					<DockedPanelPinButton
						isPinned={isPinned}
						label="event panel"
						onTogglePinned={onTogglePinned}
					/>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={closeLabel}
							onClick={onClose}
						>
							<Minus />
						</Button>
					</TooltipTrigger>
					<TooltipContent
						side="bottom"
						align="end"
						sideOffset={8}
						className="pointer-events-none select-none"
					>
						Hide
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
