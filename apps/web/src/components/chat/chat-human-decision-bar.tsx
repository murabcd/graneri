import type {
	HostedHumanDecisionRequest,
	HostedHumanDecisionResponse,
} from "@workspace/ai/hosted-human-decision";
import { Button } from "@workspace/ui/components/button";
import { Card, CardFooter, CardHeader } from "@workspace/ui/components/card";
import { ListTodo } from "lucide-react";
import * as React from "react";
import { getToolDisplayName } from "@/components/ai-elements/utils/tool-display";
import { ChatQuestionnaire } from "@/components/chat/chat-questionnaire";

const isInteractiveTarget = (target: EventTarget | null) =>
	target instanceof Element &&
	Boolean(
		target.closest('button, input, textarea, select, [contenteditable="true"]'),
	);

const lowercaseFirst = (value: string) =>
	value.length > 0 ? `${value[0]?.toLowerCase()}${value.slice(1)}` : value;

const isInternetApproval = (
	decision: Extract<HostedHumanDecisionRequest, { type: "tool_approval" }>,
) => {
	const provider = decision.authority?.provider.toLowerCase();
	return provider === "web" || provider === "internet";
};

const getApprovalTitle = (
	decision: Extract<HostedHumanDecisionRequest, { type: "tool_approval" }>,
	actionLabel: string,
) =>
	isInternetApproval(decision)
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
			className="mx-auto min-h-[132px] w-full max-w-full gap-0 rounded-lg py-0 shadow-lg data-[size=sm]:py-0"
			role="group"
			aria-label={`Approve ${actionLabel}`}
		>
			<CardHeader className="flex flex-row items-center gap-3 px-4 pt-3 pb-2">
				<ListTodo
					data-slot="approval-status-icon"
					aria-hidden="true"
					className="size-[18px] shrink-0 text-emerald-500"
				/>
				<span className="shrink-0 font-medium text-foreground">Approval</span>
				<span className="min-w-0 text-muted-foreground">
					{getApprovalTitle(decision, actionLabel)}
				</span>
			</CardHeader>
			<CardFooter className="mt-auto justify-end gap-2 border-t-0 bg-transparent px-4 pt-0 pb-3">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => respond(false)}
					aria-keyshortcuts="Escape"
				>
					Deny
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={disabled}
					onClick={() => respond(true)}
					aria-keyshortcuts="Enter"
				>
					Allow once
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
