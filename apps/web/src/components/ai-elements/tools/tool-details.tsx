import type { JSONValue } from "ai";
import { formatToolPayload } from "@/components/ai-elements/utils/tool-display";

export function ToolDetails({
	input,
	output,
	errorText,
}: {
	errorText?: string;
	input?: JSONValue;
	output?: JSONValue;
}) {
	const inputText = formatToolPayload(input);
	const outputText = formatToolPayload(output);

	if (!inputText && !outputText && !errorText) {
		return null;
	}

	return (
		<div className="space-y-2">
			{errorText ? <ToolPayloadBlock label="Error" value={errorText} /> : null}
			{inputText ? <ToolPayloadBlock label="Input" value={inputText} /> : null}
			{outputText ? (
				<ToolPayloadBlock label="Output" value={outputText} />
			) : null}
		</div>
	);
}

function ToolPayloadBlock({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="mb-1 text-[11px] font-medium text-muted-foreground">
				{label}
			</div>
			<pre className="max-h-56 overflow-auto rounded-[5px] bg-muted/45 p-2 font-mono text-[11px] leading-4 text-foreground">
				{value}
			</pre>
		</div>
	);
}
