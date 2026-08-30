import {
	type GeneratedArtifact,
	parseArtifactToolOutput,
} from "@workspace/ai/artifact-authoring-contract";
import {
	type ChatMessageMetadata,
	parseChatMessageMetadata,
} from "@workspace/ai/chat-message-metadata";
import { type FileUIPart, isToolUIPart, type UIMessage } from "ai";
import { getChatFileIdentity } from "@/lib/chat-file-attachment";

export { type ChatMessageMetadata, parseChatMessageMetadata };

export const parseGeneratedArtifacts = (value: unknown): GeneratedArtifact[] =>
	parseArtifactToolOutput(value)?.artifacts ?? [];

const extractTextParts = (message: UIMessage) =>
	message.parts.filter(
		(part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0,
	);

export const extractFileParts = (message: UIMessage) =>
	message.parts.filter(
		(part): part is Extract<(typeof message.parts)[number], { type: "file" }> =>
			part.type === "file" &&
			typeof part.url === "string" &&
			part.url.length > 0,
	);

export const extractToolParts = (message: UIMessage) =>
	message.parts.filter(isToolUIPart);

export const extractGeneratedArtifacts = (
	message: UIMessage,
): GeneratedArtifact[] =>
	extractToolParts(message).flatMap((part) => {
		if (!("state" in part) || part.state !== "output-available") {
			return [];
		}

		const artifacts = parseGeneratedArtifacts(
			"output" in part ? part.output : null,
		);

		return artifacts;
	});

const toFilePart = (artifact: GeneratedArtifact): FileUIPart => ({
	type: "file",
	filename: artifact.filename,
	mediaType: artifact.mediaType,
	providerMetadata: {
		graneri: {
			...artifact.providerMetadata.graneri,
			sizeBytes: artifact.sizeBytes,
		},
	},
	url: artifact.url,
});

export const extractMessageFileParts = (message: UIMessage): FileUIPart[] => {
	const files = [
		...extractFileParts(message),
		...(message.role === "assistant"
			? extractGeneratedArtifacts(message).map(toFilePart)
			: []),
	];
	const seenIdentities = new Set<string>();

	return files.filter((file) => {
		const identity = getChatFileIdentity(file);
		if (seenIdentities.has(identity)) {
			return false;
		}

		seenIdentities.add(identity);
		return true;
	});
};

export const extractReasoningParts = (message: UIMessage) =>
	message.parts.filter((part) => part.type === "reasoning");

export const getChatText = (message: UIMessage) =>
	extractTextParts(message)
		.map((part) => part.text)
		.join("\n\n")
		.trim();

export const getChatMessageMetadata = (
	message: UIMessage,
): ChatMessageMetadata | null => parseChatMessageMetadata(message.metadata);
