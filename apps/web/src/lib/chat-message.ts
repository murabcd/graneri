import type { UIMessage } from "ai";
import type {
	ChatMessageMention,
	ChatRecipeReceipt,
} from "@/lib/chat-composer-mentions";
import { isChatAppSourceProvider } from "@/lib/chat-source-display";

type ChatMessageMetadataBase = {
	interrupted?: boolean;
	mentionPositions?: ChatMessageMention[];
};

export type ChatMessageMetadata = ChatMessageMetadataBase &
	(
		| {
				recipe: ChatRecipeReceipt;
				recipeOnly: boolean;
		  }
		| {
				recipe?: never;
				recipeOnly?: never;
		  }
	);

export type ChatGeneratedArtifact = {
	filename?: string;
	mediaType: string;
	url: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseChatMessageMention = (value: unknown): ChatMessageMention | null => {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.label !== "string" ||
		typeof value.from !== "number" ||
		typeof value.to !== "number" ||
		!Number.isInteger(value.from) ||
		!Number.isInteger(value.to) ||
		value.from < 0 ||
		value.to <= value.from
	) {
		return null;
	}

	const base = {
		id: value.id,
		label: value.label,
		from: value.from,
		to: value.to,
	};
	if (value.type === "note") {
		return { ...base, type: "note" };
	}
	if (value.type === "tool" && isChatAppSourceProvider(value.provider)) {
		return { ...base, type: "tool", provider: value.provider };
	}
	return null;
};

const parseChatRecipeReceipt = (value: unknown): ChatRecipeReceipt | null => {
	if (
		!isRecord(value) ||
		typeof value.slug !== "string" ||
		!value.slug ||
		typeof value.name !== "string" ||
		!value.name
	) {
		return null;
	}
	return { slug: value.slug, name: value.name };
};

export const parseChatMessageMetadata = (
	value: unknown,
): ChatMessageMetadata | null => {
	if (!isRecord(value)) {
		return null;
	}

	if (
		value.interrupted !== undefined &&
		typeof value.interrupted !== "boolean"
	) {
		return null;
	}

	const recipe =
		value.recipe === undefined
			? undefined
			: parseChatRecipeReceipt(value.recipe);
	if (value.recipe !== undefined && !recipe) {
		return null;
	}
	if (
		(recipe && typeof value.recipeOnly !== "boolean") ||
		(!recipe && value.recipeOnly !== undefined)
	) {
		return null;
	}

	let mentionPositions: ChatMessageMention[] | undefined;
	if (value.mentionPositions !== undefined) {
		if (!Array.isArray(value.mentionPositions)) {
			return null;
		}
		mentionPositions = [];
		for (const mentionValue of value.mentionPositions) {
			const mention = parseChatMessageMention(mentionValue);
			if (!mention) {
				return null;
			}
			mentionPositions.push(mention);
		}
	}

	const metadata: ChatMessageMetadataBase = {
		...(value.interrupted === undefined
			? {}
			: { interrupted: value.interrupted }),
		...(mentionPositions ? { mentionPositions } : {}),
	};
	if (recipe && typeof value.recipeOnly === "boolean") {
		return { ...metadata, recipe, recipeOnly: value.recipeOnly };
	}
	return metadata;
};

export const parseGeneratedArtifact = (
	value: unknown,
): ChatGeneratedArtifact | null => {
	if (!value || typeof value !== "object") {
		return null;
	}

	const { filename, mediaType, url } = value as {
		filename?: unknown;
		mediaType?: unknown;
		url?: unknown;
	};

	if (
		typeof mediaType !== "string" ||
		typeof url !== "string" ||
		mediaType.length === 0 ||
		url.length === 0
	) {
		return null;
	}

	return {
		filename: typeof filename === "string" ? filename : undefined,
		mediaType,
		url,
	};
};

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
	message.parts.filter(
		(part) => part.type.startsWith("tool-") || part.type === "dynamic-tool",
	);

export const extractGeneratedArtifacts = (
	message: UIMessage,
): ChatGeneratedArtifact[] =>
	extractToolParts(message).flatMap((part) => {
		if (part.type !== "tool-generate_image") {
			return [];
		}

		if (!("state" in part) || part.state !== "output-available") {
			return [];
		}

		const artifact = parseGeneratedArtifact(
			"output" in part ? part.output : null,
		);

		return artifact ? [artifact] : [];
	});

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
