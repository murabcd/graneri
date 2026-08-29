import { InputGroupButton } from "@workspace/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { type LucideIcon, X } from "lucide-react";

export function ActiveComposerOption({
	disableLabel,
	icon: Icon,
	label,
	onDisable,
}: {
	disableLabel: string;
	icon: LucideIcon;
	label: string;
	onDisable: () => void;
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
					<span data-slot="active-option-label" className="hidden sm:inline">
						{label}
					</span>
				</InputGroupButton>
			</TooltipTrigger>
			<TooltipContent>{disableLabel}</TooltipContent>
		</Tooltip>
	);
}
