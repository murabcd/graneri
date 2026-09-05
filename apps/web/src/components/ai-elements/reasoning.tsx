import { Brain } from "lucide-react";
import { ToolRowBase } from "@/components/ai-elements/tools/tool-row-base";
import { MarkdownStream } from "@/components/chat/markdown-stream";

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
				<MarkdownStream
					className="text-sm text-muted-foreground"
					isAnimating={isStreaming}
					mode={isStreaming ? "streaming" : "static"}
				>
					{trimmedText}
				</MarkdownStream>
			</div>
		</ToolRowBase>
	);
}
