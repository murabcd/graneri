import { InputGroupButton } from "@workspace/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { type LucideIcon, X } from "lucide-react";
import type { ReactNode } from "react";

export function ActiveComposerOption({
	disableLabel,
	icon: Icon,
	label,
	labelClassName,
	onDisable,
	tooltipLabel = disableLabel,
}: {
	disableLabel: string;
	icon: LucideIcon;
	label: ReactNode;
	labelClassName?: string;
	onDisable: () => void;
	tooltipLabel?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<InputGroupButton
					type="button"
					aria-label={disableLabel}
					className="group size-6 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent sm:w-auto"
					onClick={onDisable}
				>
					<span
						data-slot="active-option-glyph"
						className="flex size-6 shrink-0 items-center justify-center rounded-full group-hover:bg-muted dark:group-hover:bg-muted/50"
					>
						<Icon aria-hidden="true" className="group-hover:hidden" />
						<X aria-hidden="true" className="hidden group-hover:block" />
					</span>
					<span
						data-slot="active-option-label"
						className={cn("hidden sm:inline", labelClassName)}
					>
						{label}
					</span>
				</InputGroupButton>
			</TooltipTrigger>
			<TooltipContent>{tooltipLabel}</TooltipContent>
		</Tooltip>
	);
}
