import type { ToolApprovalRequest } from "@workspace/ai/tool-approval-state";
import { cn } from "@workspace/ui/lib/utils";
import {
	formatToolPayload,
	getToolDisplayName,
} from "@/components/ai-elements/utils/tool-display";

export function ChatToolApprovalBar({
	approval,
	disabled,
	onRespond,
}: {
	approval: ToolApprovalRequest;
	disabled?: boolean;
	onRespond: (approved: boolean) => void;
}) {
	const actionLabel = getToolDisplayName(approval.toolName);
	const providerLabel = approval.authority?.provider
		? getToolDisplayName(approval.authority.provider)
		: null;
	const inputText = formatToolPayload(approval.input);

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
			<div className="space-y-2 border-b border-border/20 bg-muted/20 px-3.5 py-2.5 text-muted-foreground">
				<p>
					{providerLabel
						? `This action can change data in ${providerLabel}.`
						: "This action can change data or perform an external action."}
				</p>
				{inputText ? (
					<details>
						<summary className="cursor-pointer font-medium text-foreground">
							Review action input
						</summary>
						<pre className="mt-2 max-h-40 overflow-auto rounded-[5px] bg-background/80 p-2 font-mono text-[11px] leading-4 text-foreground">
							{inputText}
						</pre>
					</details>
				) : null}
			</div>
			{[
				{ approved: true, label: "Approve" },
				{ approved: false, label: "Deny" },
			].map((option, index) => (
				<button
					key={option.label}
					type="button"
					aria-label={option.label}
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
