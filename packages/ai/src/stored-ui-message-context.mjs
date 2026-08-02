import { z } from "zod";
import { decodeTrustedStoredUiMessage } from "./ui-message-codec.mjs";

const MAX_COMPACTION_MESSAGE_CHARS = 4_000;
const MAX_TOOL_CONTEXT_CHARS = 8_000;

const completedToolPartBaseSchema = z.object({
	errorText: z.unknown().optional(),
	input: z.unknown().optional(),
	output: z.unknown().optional(),
	state: z.enum(["output-available", "output-error"]),
});

const completedToolPartSchema = z.union([
	completedToolPartBaseSchema.extend({
		toolName: z.string().min(1),
		type: z.literal("dynamic-tool"),
	}),
	completedToolPartBaseSchema.extend({
		type: z
			.string()
			.startsWith("tool-")
			.min("tool-".length + 1),
	}),
]);

const clampText = (value, maxLength) =>
	value.length <= maxLength
		? value
		: `${value.slice(0, maxLength)}\n[truncated]`;

const stringifyContextValue = (value) => {
	if (value === undefined) {
		return "undefined";
	}
	return typeof value === "string" ? value : JSON.stringify(value);
};

const renderCompletedToolPart = (part) => {
	const toolName =
		part.type === "dynamic-tool"
			? part.toolName
			: part.type.slice("tool-".length);
	return clampText(
		`[tool ${String(toolName)} ${part.state}] input=${stringifyContextValue(part.input)} output=${stringifyContextValue(part.output)} error=${stringifyContextValue(part.errorText)}`,
		MAX_TOOL_CONTEXT_CHARS,
	);
};

const readStoredUiMessageContext = (message) => {
	const decoded = decodeTrustedStoredUiMessage(message);
	const content = decoded.parts.flatMap((part) => {
		if (part.type === "text" && part.text.length > 0) {
			return [part.text];
		}
		const completedToolPart = completedToolPartSchema.safeParse(part);
		return completedToolPart.success
			? [renderCompletedToolPart(completedToolPart.data)]
			: [];
	});
	return { decoded, content };
};

export const projectStoredUiMessagesForAssistantRun = (messages) =>
	messages.flatMap((message) => {
		const { content, decoded } = readStoredUiMessageContext(message);
		return content.length === 0
			? []
			: [
					{
						id: decoded.id,
						role: decoded.role,
						...(decoded.metadata === undefined
							? {}
							: { metadata: decoded.metadata }),
						parts: content.map((text) => ({ type: "text", text })),
					},
				];
	});

export const buildStoredUiMessageCompactionTranscript = (messages) =>
	messages
		.map((message) => {
			const { content, decoded } = readStoredUiMessageContext(message);
			return clampText(
				`${decoded.role.toUpperCase()}:\n${content.join("\n").trim() || "[no consequential content]"}`,
				MAX_COMPACTION_MESSAGE_CHARS,
			);
		})
		.join("\n\n");
