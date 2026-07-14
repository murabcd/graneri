import type { ToolApprovalRequest } from "@workspace/ai/tool-approval-state";
import { cn } from "@workspace/ui/lib/utils";

const humanizeToolName = (toolName: string) =>
	toolName
		.split("_")
		.filter(Boolean)
		.map((word, index) =>
			index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word,
		)
		.join(" ");

export function ChatToolApprovalBar({
	approval,
	disabled,
	onRespond,
}: {
	approval: ToolApprovalRequest;
	disabled?: boolean;
	onRespond: (approved: boolean) => void;
}) {
	const actionLabel = humanizeToolName(approval.toolName);

	return (
		<fieldset
			className={cn(
				"mx-auto w-[calc(100%-1rem)] max-w-[548px] overflow-hidden rounded-t-lg rounded-b-none bg-transparent text-sm",
			)}
			aria-label={`Approve ${actionLabel}`}
		>
			<div className="flex h-9 items-center gap-3 border-border/20 bg-muted/30 px-3.5 outline-none first:rounded-t-lg not-last:border-b">
				<legend className="shrink-0 font-medium text-foreground">
					Approval
				</legend>
				<span className="min-w-0 truncate text-muted-foreground">
					{actionLabel}
				</span>
			</div>
			{[
				{ approved: true, label: "Approve" },
				{ approved: false, label: "Deny" },
			].map((option, index) => (
				<button
					key={option.label}
					type="button"
					disabled={disabled}
					onClick={() => onRespond(option.approved)}
					className="flex h-9 w-full items-center gap-3 border-border/20 bg-muted/30 px-3.5 text-left outline-none transition-colors not-last:border-b hover:bg-muted/45 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
				>
					<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-medium text-muted-foreground">
						{String.fromCharCode(65 + index)}
					</span>
					<span className="min-w-0 truncate font-medium text-foreground">
						{option.label}
					</span>
				</button>
			))}
		</fieldset>
	);
}
