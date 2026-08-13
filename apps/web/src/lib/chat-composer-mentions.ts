import type { JSONContent } from "@tiptap/core";
import type {
	ChatMessageMention,
	ChatRecipeReceipt,
} from "@workspace/ai/chat-message-metadata";
import { isChatAppSourceProvider } from "@/lib/chat-source-display";

export type { ChatMessageMention, ChatRecipeReceipt };

type ChatComposerMentionBase = {
	id: string;
	label: string;
	from: number;
	to: number;
};

export type ChatComposerMention =
	| ChatMessageMention
	| (ChatComposerMentionBase & {
			type: "recipe";
	  });

const createEmptyDocument = (): JSONContent => ({
	type: "doc",
	content: [{ type: "paragraph" }],
});

const isValidMentionRange = (
	draft: string,
	mention: ChatComposerMention,
): boolean =>
	Number.isInteger(mention.from) &&
	Number.isInteger(mention.to) &&
	mention.from >= 0 &&
	mention.to > mention.from &&
	mention.to <= draft.length &&
	draft.slice(mention.from, mention.to) === `@${mention.label}`;

const getMentionNode = (mention: ChatComposerMention): JSONContent => ({
	type: "mention",
	attrs: {
		id: mention.id,
		label: mention.label,
		type: mention.type,
		...(mention.type === "tool" && { provider: mention.provider }),
	},
});

export const createChatComposerDocument = (
	draft: string,
	mentions: ChatComposerMention[] = [],
): JSONContent => {
	if (!draft) {
		return createEmptyDocument();
	}

	const sortedMentions = mentions.toSorted(
		(left, right) => left.from - right.from,
	);
	if (sortedMentions.some((mention) => !isValidMentionRange(draft, mention))) {
		throw new Error("Chat composer mention ranges do not match the draft.");
	}
	const paragraphs: JSONContent[] = [];
	let paragraphContent: JSONContent[] = [];
	let cursor = 0;

	const finishParagraph = () => {
		paragraphs.push({
			type: "paragraph",
			...(paragraphContent.length > 0 && { content: paragraphContent }),
		});
		paragraphContent = [];
	};
	const appendText = (value: string) => {
		const lines = value.split("\n");
		for (const [index, line] of lines.entries()) {
			if (line) {
				paragraphContent.push({ type: "text", text: line });
			}
			if (index < lines.length - 1) {
				finishParagraph();
			}
		}
	};

	for (const mention of sortedMentions) {
		if (mention.from < cursor) {
			throw new Error("Chat composer mentions cannot overlap.");
		}
		appendText(draft.slice(cursor, mention.from));
		paragraphContent.push(getMentionNode(mention));
		cursor = mention.to;
	}

	appendText(draft.slice(cursor));
	finishParagraph();

	return {
		type: "doc",
		content: paragraphs,
	};
};

const readMentionNode = (
	node: JSONContent,
	from: number,
): ChatComposerMention | null => {
	if (node.type !== "mention") {
		return null;
	}
	if (
		typeof node.attrs?.id !== "string" ||
		typeof node.attrs.label !== "string"
	) {
		throw new Error("Chat composer contains an invalid mention.");
	}

	const base = {
		id: node.attrs.id,
		label: node.attrs.label,
		from,
		to: from + `@${node.attrs.label}`.length,
	};
	if (node.attrs.type === "note" || node.attrs.type === "recipe") {
		return {
			...base,
			type: node.attrs.type,
		};
	}
	if (
		node.attrs.type === "tool" &&
		isChatAppSourceProvider(node.attrs.provider)
	) {
		return {
			...base,
			type: "tool",
			provider: node.attrs.provider,
		};
	}

	throw new Error("Chat composer contains an invalid mention kind.");
};

export const getChatComposerMentions = (
	document: JSONContent,
): ChatComposerMention[] => {
	const mentions: ChatComposerMention[] = [];
	let textOffset = 0;
	const paragraphs = document.content ?? [];

	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		if (paragraphIndex > 0) {
			textOffset += 1;
		}
		for (const node of paragraph.content ?? []) {
			const mention = readMentionNode(node, textOffset);
			if (mention) {
				mentions.push(mention);
				textOffset = mention.to;
				continue;
			}
			if (typeof node.text === "string") {
				textOffset += node.text.length;
			}
		}
	}

	return mentions;
};

export const areChatComposerMentionsEqual = (
	left: ChatComposerMention[],
	right: ChatComposerMention[],
): boolean =>
	left.length === right.length &&
	left.every((mention, index) => {
		const otherMention = right[index];
		return (
			mention.id === otherMention?.id &&
			mention.label === otherMention.label &&
			mention.from === otherMention.from &&
			mention.to === otherMention.to &&
			mention.type === otherMention.type &&
			(mention.type !== "tool" ||
				(otherMention?.type === "tool" &&
					mention.provider === otherMention.provider))
		);
	});

const getSelectedRecipeMention = (
	mentions: ChatComposerMention[],
): Extract<ChatComposerMention, { type: "recipe" }> | null => {
	const recipeMentions = mentions.filter(
		(mention): mention is Extract<ChatComposerMention, { type: "recipe" }> =>
			mention.type === "recipe",
	);
	if (recipeMentions.length > 1) {
		throw new Error("A chat message can use only one recipe.");
	}
	return recipeMentions[0] ?? null;
};

export const hasSelectedRecipeMention = (
	mentions: ChatComposerMention[],
): boolean => getSelectedRecipeMention(mentions) !== null;

export const filterChatRecipeMentionOptions = (
	recipes: ChatRecipeReceipt[],
	query: string,
): ChatRecipeReceipt[] => {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return [];
	}
	return recipes.filter((recipe) =>
		`${recipe.name} ${recipe.slug}`.toLowerCase().includes(normalizedQuery),
	);
};

const shiftMentionAfterRecipeRemoval = ({
	leadingWhitespaceLength,
	mention,
	recipeMention,
}: {
	leadingWhitespaceLength: number;
	mention: ChatMessageMention;
	recipeMention: Extract<ChatComposerMention, { type: "recipe" }> | null;
}): ChatMessageMention => {
	const removedLength = recipeMention
		? recipeMention.to - recipeMention.from
		: 0;
	const offsetAfterRemoval =
		recipeMention && mention.from >= recipeMention.to ? removedLength : 0;

	return {
		...mention,
		from: mention.from - offsetAfterRemoval - leadingWhitespaceLength,
		to: mention.to - offsetAfterRemoval - leadingWhitespaceLength,
	};
};

export const prepareChatComposerSubmission = ({
	draft,
	mentions,
	recipes,
}: {
	draft: string;
	mentions: ChatComposerMention[];
	recipes: ChatRecipeReceipt[];
}): {
	displayText: string;
	messageText: string;
	mentionPositions: ChatMessageMention[];
	recipe: ChatRecipeReceipt | null;
	recipeOnly: boolean;
	recipeSlug: string | null;
} => {
	const recipeMention = getSelectedRecipeMention(mentions);
	const selectedRecipe = recipeMention
		? recipes.find((recipe) => recipe.slug === recipeMention.id)
		: null;
	if (recipeMention && !selectedRecipe) {
		throw new Error("The selected recipe is no longer available.");
	}

	const textWithoutRecipe = recipeMention
		? `${draft.slice(0, recipeMention.from)}${draft.slice(recipeMention.to)}`
		: draft;
	const leadingWhitespaceLength =
		textWithoutRecipe.length - textWithoutRecipe.trimStart().length;
	const messageText = textWithoutRecipe.trim();
	const mentionPositions = mentions
		.filter(
			(mention): mention is ChatMessageMention => mention.type !== "recipe",
		)
		.map((mention) =>
			shiftMentionAfterRecipeRemoval({
				leadingWhitespaceLength,
				mention,
				recipeMention,
			}),
		);
	const recipe = selectedRecipe
		? { slug: selectedRecipe.slug, name: selectedRecipe.name }
		: null;

	return {
		displayText: messageText || selectedRecipe?.name || "",
		messageText,
		mentionPositions,
		recipe,
		recipeOnly: Boolean(selectedRecipe && !messageText),
		recipeSlug: selectedRecipe?.slug ?? null,
	};
};

export const createChatComposerEditDraft = ({
	mentionPositions,
	recipe,
	text,
}: {
	mentionPositions: ChatMessageMention[];
	recipe: ChatRecipeReceipt | null;
	text: string;
}): {
	mentions: ChatComposerMention[];
	text: string;
} => {
	if (!recipe) {
		return { mentions: mentionPositions, text };
	}

	const recipeText = `@${recipe.name}`;
	const separator = text ? " " : "";
	const offset = recipeText.length + separator.length;

	return {
		text: `${recipeText}${separator}${text}`,
		mentions: [
			{
				id: recipe.slug,
				label: recipe.name,
				from: 0,
				to: recipeText.length,
				type: "recipe",
			},
			...mentionPositions.map((mention) => ({
				...mention,
				from: mention.from + offset,
				to: mention.to + offset,
			})),
		],
	};
};

export const getWorkspaceChatMentionContext = (
	mentions: ChatComposerMention[],
) => {
	const noteIds: string[] = [];
	const sourceIds: string[] = [];

	for (const mention of mentions) {
		if (mention.type === "note") {
			noteIds.push(mention.id);
		}
		if (mention.type === "tool") {
			sourceIds.push(mention.id);
		}
	}

	return {
		mentionIds: [...new Set(noteIds)],
		requestSelectedSourceIds: [...new Set(sourceIds)],
		recipeSlug: getSelectedRecipeMention(mentions)?.id ?? null,
	};
};
