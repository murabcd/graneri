import { z } from "zod";
import {
	parseUiMessagePartsJson,
	tryParseUiMessageMetadataJson,
} from "./ui-message-codec.mjs";

export const LOCAL_FOLDER_TOOL_NAMES = [
	"get_shared_local_folders",
	"inspect_local_image",
	"list_local_directory",
	"read_local_file",
	"run_local_bash",
	"search_local_files",
	"search_local_images",
];

const localFolderToolNameSet = new Set(LOCAL_FOLDER_TOOL_NAMES);

export const isLocalFolderToolName = (toolName) =>
	localFolderToolNameSet.has(toolName);

const toolPartSchema = z.looseObject({
	errorText: z.string().optional(),
	output: z.unknown().optional(),
	state: z.string(),
	toolCallId: z.string().min(1),
	toolName: z.string().optional(),
	type: z.string(),
});

const getToolName = (part) => {
	if (part.type === "dynamic-tool") {
		return part.toolName ?? null;
	}

	return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null;
};

const getLocalFolderToolPart = (value) => {
	const result = toolPartSchema.safeParse(value);
	if (!result.success) {
		return null;
	}

	const toolName = getToolName(result.data);
	return toolName && isLocalFolderToolName(toolName)
		? { part: result.data, toolName }
		: null;
};

const getCompletedLocalFolderToolPart = (value) => {
	const localToolPart = getLocalFolderToolPart(value);
	if (!localToolPart) {
		return null;
	}

	const { part } = localToolPart;
	if (part.state === "output-available" && "output" in part) {
		return localToolPart;
	}
	if (
		part.state === "output-error" &&
		typeof part.errorText === "string" &&
		part.errorText.length > 0
	) {
		return localToolPart;
	}

	return null;
};

export const isLocalFolderToolContinuationMessage = (message) => {
	if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
		return false;
	}

	let localToolPartCount = 0;
	let completedLocalToolPartCount = 0;
	for (const part of message.parts) {
		if (getLocalFolderToolPart(part)) {
			localToolPartCount += 1;
		}
		if (getCompletedLocalFolderToolPart(part)) {
			completedLocalToolPartCount += 1;
		}
	}

	return (
		localToolPartCount > 0 && localToolPartCount === completedLocalToolPartCount
	);
};

export const createCanonicalLocalFolderToolContinuation = ({
	message,
	storedMessage,
}) => {
	if (
		!isLocalFolderToolContinuationMessage(message) ||
		storedMessage?.role !== "assistant" ||
		storedMessage.id !== message.id
	) {
		throw new Error("Local folder tool continuation is invalid.");
	}

	const completedPartsByCallId = new Map();
	for (const value of message.parts) {
		const completedPart = getCompletedLocalFolderToolPart(value);
		if (!completedPart) {
			continue;
		}
		if (completedPartsByCallId.has(completedPart.part.toolCallId)) {
			throw new Error("Local folder tool continuation is ambiguous.");
		}
		completedPartsByCallId.set(completedPart.part.toolCallId, completedPart);
	}

	const storedParts = parseUiMessagePartsJson(storedMessage.partsJson);
	const matchedCallIds = new Set();
	const parts = storedParts.map((value) => {
		const storedPart = getLocalFolderToolPart(value);
		if (!storedPart) {
			return value;
		}

		const completedPart = completedPartsByCallId.get(
			storedPart.part.toolCallId,
		);
		if (!completedPart || completedPart.toolName !== storedPart.toolName) {
			throw new Error(
				"Local folder tool continuation does not match the stored tool call.",
			);
		}
		matchedCallIds.add(storedPart.part.toolCallId);

		const {
			errorText: _storedErrorText,
			output: _storedOutput,
			...storedPartWithoutOutput
		} = storedPart.part;
		return completedPart.part.state === "output-error"
			? {
					...storedPartWithoutOutput,
					errorText: completedPart.part.errorText,
					state: "output-error",
				}
			: {
					...storedPartWithoutOutput,
					output: completedPart.part.output,
					state: "output-available",
				};
	});

	if (matchedCallIds.size !== completedPartsByCallId.size) {
		throw new Error(
			"Local folder tool continuation contains an unknown tool call.",
		);
	}

	const metadata = tryParseUiMessageMetadataJson(storedMessage.metadataJson);
	return {
		id: storedMessage.id,
		role: "assistant",
		parts,
		...(metadata !== undefined && { metadata }),
	};
};
