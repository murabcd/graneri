import {
	type DynamicToolUIPart,
	getToolName,
	isToolUIPart,
	type JSONValue,
	type ToolUIPart,
	type UIMessage,
} from "ai";
import { z } from "zod";
import {
	getToolMeta,
	type ToolPartLike,
} from "@/components/ai-elements/tools/tool-registry";

export type ToolUiPart = ToolUIPart | DynamicToolUIPart;
export type AssistantWorkPart =
	| Extract<UIMessage["parts"][number], { type: "reasoning" }>
	| ToolUiPart;

const toolPayloadSchema = z.json();

const parseToolPayload = (value: unknown): JSONValue | undefined => {
	const result = toolPayloadSchema.safeParse(value);
	return result.success ? result.data : undefined;
};

export const toToolPartLike = (part: ToolUiPart): ToolPartLike => ({
	errorText: part.errorText,
	input: parseToolPayload(part.input),
	output: parseToolPayload(part.output),
	state: part.state,
	toolCallId: part.toolCallId,
	toolMetadata: part.toolMetadata,
	toolName: getToolName(part),
	type: part.type,
});

export const isRenderableToolUiPart = (
	part: UIMessage["parts"][number],
): part is ToolUiPart =>
	isToolUIPart(part) && getToolMeta(toToolPartLike(part)) !== null;

export const isAssistantWorkPart = (
	part: UIMessage["parts"][number],
): part is AssistantWorkPart =>
	part.type === "reasoning" || isRenderableToolUiPart(part);

export const isRenderableAssistantWorkPart = (
	part: UIMessage["parts"][number],
	isWorking: boolean,
): part is AssistantWorkPart =>
	isAssistantWorkPart(part) &&
	(part.type !== "reasoning" ||
		part.text.trim().length > 0 ||
		(isWorking && part.state !== "done"));
