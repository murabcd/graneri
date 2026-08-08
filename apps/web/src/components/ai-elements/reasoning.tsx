import { Brain } from "lucide-react";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";

export function Reasoning({
	isStreaming,
	text,
}: {
	isStreaming: boolean;
	text: string;
}) {
	const trimmedText = text.trim();

	if (!trimmedText && !isStreaming) {
		return null;
	}

	return (
		<ToolRowBase
			icon={<Brain className="size-full shrink-0 text-muted-foreground" />}
			shimmerLabel="Thinking"
			completeLabel="Thought"
			isAnimating={isStreaming}
			expandable={Boolean(trimmedText)}
			hideChevronUntilHover
		>
			<div className="max-h-[175px] overflow-y-auto">
				<p className="whitespace-pre-wrap text-sm text-muted-foreground">
					{trimmedText}
				</p>
			</div>
		</ToolRowBase>
	);
}
