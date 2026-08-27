import type {
	HostedHumanDecisionRequest,
	HostedHumanDecisionResponse,
} from "@workspace/ai/hosted-human-decision";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { Kbd } from "@workspace/ui/components/kbd";
import { CornerDownLeft, Hand } from "lucide-react";
import * as React from "react";
import {
	formatToolPayload,
	getToolDisplayName,
} from "@/components/ai-elements/utils/tool-display";
import { ChatQuestionnaire } from "@/components/chat/chat-questionnaire";

const isInteractiveTarget = (target: EventTarget | null) =>
	target instanceof Element &&
	Boolean(
		target.closest(
			'button, summary, input, textarea, select, [contenteditable="true"]',
		),
	);

const lowercaseFirst = (value: string) =>
	value.length > 0 ? `${value[0]?.toLowerCase()}${value.slice(1)}` : value;

const getApprovalCategory = (
	decision: Extract<HostedHumanDecisionRequest, { type: "tool_approval" }>,
) => {
	const provider = decision.authority?.provider.toLowerCase();
	if (provider === "web" || provider === "internet") {
		return "Internet access";
	}
	if (decision.authority?.access === "write") {
		return "Write access";
	}
	if (decision.authority?.access === "read") {
		return "Read access";
	}
	return "Action approval";
};

const getApprovalTitle = (
	decision: Extract<HostedHumanDecisionRequest, { type: "tool_approval" }>,
	actionLabel: string,
) =>
	getApprovalCategory(decision) === "Internet access"
		? "Allow Graneri to connect to the internet?"
		: `Allow Graneri to ${lowercaseFirst(actionLabel)}?`;

function ChatToolApproval({
	decision,
	disabled,
	onRespond,
}: {
	decision: Extract<HostedHumanDecisionRequest, { type: "tool_approval" }>;
	disabled?: boolean;
	onRespond: (response: HostedHumanDecisionResponse) => void;
}) {
	const actionLabel = getToolDisplayName(decision.toolName);
	const inputText = formatToolPayload(decision.input);
	const respond = React.useCallback(
		(approved: boolean) => {
			if (!disabled) {
				onRespond({ type: "tool_approval", approved });
			}
		},
		[disabled, onRespond],
	);

	const handleShortcut = React.useEffectEvent((event: KeyboardEvent) => {
		if (
			disabled ||
			event.defaultPrevented ||
			event.isComposing ||
			event.repeat ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			isInteractiveTarget(event.target)
		) {
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			respond(false);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			respond(true);
		}
	});

	React.useEffect(() => {
		document.addEventListener("keydown", handleShortcut);
		return () => document.removeEventListener("keydown", handleShortcut);
	}, []);

	return (
		<Card
			size="sm"
			className="mx-auto w-[calc(100%-1rem)] max-w-[548px] gap-0 rounded-lg py-0 shadow-lg"
			role="group"
			aria-label={`Approve ${actionLabel}`}
		>
			<CardHeader className="gap-2 px-4 pt-4 pb-3">
				<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<Hand
						data-slot="approval-status-icon"
						aria-hidden="true"
						className="size-[18px]"
					/>
					<span>{getApprovalCategory(decision)}</span>
				</div>
				<CardTitle>{getApprovalTitle(decision, actionLabel)}</CardTitle>
				<CardDescription>{decision.consequence}</CardDescription>
			</CardHeader>
			{inputText ? (
				<CardContent className="px-4 pb-3">
					<details>
						<summary className="cursor-pointer font-medium text-foreground">
							Review action input
						</summary>
						<pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-4 text-foreground">
							{inputText}
						</pre>
					</details>
				</CardContent>
			) : null}
			<CardFooter className="justify-end gap-2 bg-transparent px-4 pt-2 pb-4">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => respond(false)}
					aria-keyshortcuts="Escape"
				>
					Deny
					<Kbd>Esc</Kbd>
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={disabled}
					onClick={() => respond(true)}
					aria-keyshortcuts="Enter"
				>
					Allow once
					<Kbd>
						<CornerDownLeft aria-label="Enter" />
					</Kbd>
				</Button>
			</CardFooter>
		</Card>
	);
}

export function ChatHumanDecisionBar({
	decision,
	disabled,
	onRespond,
}: {
	decision: HostedHumanDecisionRequest;
	disabled?: boolean;
	onRespond: (response: HostedHumanDecisionResponse) => void;
}) {
	return decision.type === "user_question" ? (
		<ChatQuestionnaire
			key={decision.toolCallId}
			decision={decision}
			disabled={disabled}
			onRespond={onRespond}
		/>
	) : (
		<ChatToolApproval
			decision={decision}
			disabled={disabled}
			onRespond={onRespond}
		/>
	);
}
