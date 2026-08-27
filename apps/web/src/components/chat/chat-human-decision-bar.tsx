import type { HostedHumanDecisionRequest } from "@workspace/ai/hosted-human-decision";
import { cn } from "@workspace/ui/lib/utils";
import {
	formatToolPayload,
	getToolDisplayName,
} from "@/components/ai-elements/utils/tool-display";

export type HumanDecisionResponse =
	| { type: "tool_approval"; approved: boolean }
	| { type: "user_question"; answer: string };

const getDecisionOptions = (decision: HostedHumanDecisionRequest) => {
	if (decision.type === "user_question") {
		return (decision.options ?? []).map((option) => ({
			label: option.label,
			description: option.description,
			response: { type: "user_question", answer: option.label } as const,
		}));
	}
	return [
		{
			label: "Approve",
			description: undefined,
			response: { type: "tool_approval", approved: true } as const,
		},
		{
			label: "Deny",
			description: undefined,
			response: { type: "tool_approval", approved: false } as const,
		},
	];
};

export function ChatHumanDecisionBar({
	decision,
	disabled,
	onRespond,
}: {
	decision: HostedHumanDecisionRequest;
	disabled?: boolean;
	onRespond: (response: HumanDecisionResponse) => void;
}) {
	const isApproval = decision.type === "tool_approval";
	const actionLabel = isApproval
		? getToolDisplayName(decision.toolName)
		: decision.question;
	const providerLabel =
		isApproval && decision.authority?.provider
			? getToolDisplayName(decision.authority.provider)
			: null;
	const inputText = isApproval ? formatToolPayload(decision.input) : null;
	const options = getDecisionOptions(decision);

	return (
		<fieldset
			className={cn(
				"mx-auto w-[calc(100%-1rem)] max-w-[548px] overflow-hidden rounded-t-lg rounded-b-none bg-transparent text-sm",
			)}
			aria-label={isApproval ? `Approve ${actionLabel}` : actionLabel}
		>
			<div className="flex min-h-9 items-center gap-3 border-border/20 bg-muted/30 px-3.5 py-2 outline-none first:rounded-t-lg not-last:border-b">
				<span className="shrink-0 font-medium text-foreground">
					{isApproval ? "Approval" : "Question"}
				</span>
				<span className="min-w-0 text-muted-foreground">{actionLabel}</span>
			</div>
			<div className="space-y-2 border-b border-border/20 bg-muted/20 px-3.5 py-2.5 text-muted-foreground">
				{decision.consequence ? <p>{decision.consequence}</p> : null}
				{providerLabel ? (
					<p>
						Connected service:{" "}
						<span className="text-foreground">{providerLabel}</span>
					</p>
				) : null}
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
				{!isApproval && decision.responseType === "text" ? (
					<p>Answer in the composer below.</p>
				) : null}
			</div>
			{options.map((option, index) => (
				<button
					key={option.label}
					type="button"
					disabled={disabled}
					onClick={() => onRespond(option.response)}
					className="flex min-h-9 w-full items-start gap-3 border-border/20 bg-muted/30 px-3.5 py-2 text-left outline-none transition-colors not-last:border-b hover:bg-muted/45 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
				>
					<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-medium text-muted-foreground">
						{String.fromCharCode(65 + index)}
					</span>
					<span className="min-w-0">
						<span className="block font-medium text-foreground">
							{option.label}
						</span>
						{option.description ? (
							<span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
								{option.description}
							</span>
						) : null}
					</span>
				</button>
			))}
		</fieldset>
	);
}
