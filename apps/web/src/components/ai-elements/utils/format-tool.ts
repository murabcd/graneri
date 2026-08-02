import type { DynamicToolUIPart, JSONValue, ToolUIPart } from "ai";

export function getToolStatus(
	part: {
		output?: JSONValue;
		state: (ToolUIPart | DynamicToolUIPart)["state"];
	},
	chatStatus?: string,
) {
	const basePending =
		part.state !== "output-available" && part.state !== "output-error";
	const output = part.output;
	const outputFailed =
		output !== null &&
		typeof output === "object" &&
		!Array.isArray(output) &&
		output.success === false;
	const isError =
		part.state === "output-error" ||
		(part.state === "output-available" && outputFailed);
	const isSuccess = part.state === "output-available" && !isError;
	const isPending =
		basePending && (chatStatus === "streaming" || chatStatus === "submitted");
	const isInterrupted =
		basePending &&
		chatStatus !== "streaming" &&
		chatStatus !== "submitted" &&
		chatStatus !== undefined;

	return { isPending, isError, isSuccess, isInterrupted };
}
