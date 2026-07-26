import { describe, expect, it } from "vitest";
import {
	areChatComposerMentionsEqual,
	type ChatComposerMention,
	type ChatRecipeReceipt,
	createChatComposerDocument,
	createChatComposerEditDraft,
	filterChatRecipeMentionOptions,
	getChatComposerMentions,
	getWorkspaceChatMentionContext,
	prepareChatComposerSubmission,
} from "@/lib/chat-composer-mentions";

const weeklyRecapRecipe = {
	slug: "weekly-recap",
	name: "Weekly recap",
} satisfies ChatRecipeReceipt;

const createMention = ({
	draft,
	id,
	label,
	type,
	provider,
}: {
	draft: string;
	id: string;
	label: string;
	type: ChatComposerMention["type"];
	provider?: "notion";
}): ChatComposerMention => {
	const from = draft.indexOf(`@${label}`);
	if (from < 0) {
		throw new Error(`Missing @${label} in test draft.`);
	}

	const base = {
		id,
		label,
		from,
		to: from + label.length + 1,
	};
	if (type === "tool") {
		if (!provider) {
			throw new Error("Tool mentions require a provider in test drafts.");
		}
		return { ...base, type, provider };
	}
	return { ...base, type };
};

describe("chat composer mentions", () => {
	it("keeps recipes hidden until the mention query has text", () => {
		expect(filterChatRecipeMentionOptions([weeklyRecapRecipe], "")).toEqual([]);
		expect(
			filterChatRecipeMentionOptions([weeklyRecapRecipe], "weekly"),
		).toEqual([weeklyRecapRecipe]);
	});

	it("round-trips typed mentions and multiline text through the editor document", () => {
		const draft = "@Weekly recap\nUse @Roadmap with @Notion";
		const mentions: ChatComposerMention[] = [
			createMention({
				draft,
				id: weeklyRecapRecipe.slug,
				label: weeklyRecapRecipe.name,
				type: "recipe",
			}),
			createMention({
				draft,
				id: "note-1",
				label: "Roadmap",
				type: "note",
			}),
			createMention({
				draft,
				id: "app:notion",
				label: "Notion",
				type: "tool",
				provider: "notion",
			}),
		];

		expect(
			areChatComposerMentionsEqual(
				getChatComposerMentions(createChatComposerDocument(draft, mentions)),
				mentions,
			),
		).toBe(true);
	});

	it("removes the recipe mention and shifts persisted note and tool positions", () => {
		const draft = "@Weekly recap with @Roadmap via @Notion";
		const recipeMention = createMention({
			draft,
			id: weeklyRecapRecipe.slug,
			label: weeklyRecapRecipe.name,
			type: "recipe",
		});
		const noteMention = createMention({
			draft,
			id: "note-1",
			label: "Roadmap",
			type: "note",
		});
		const toolMention = createMention({
			draft,
			id: "app:notion",
			label: "Notion",
			type: "tool",
			provider: "notion",
		});

		expect(
			prepareChatComposerSubmission({
				draft,
				mentions: [recipeMention, noteMention, toolMention],
				recipes: [weeklyRecapRecipe],
			}),
		).toEqual({
			displayText: "with @Roadmap via @Notion",
			messageText: "with @Roadmap via @Notion",
			mentionPositions: [
				{ ...noteMention, from: 5, to: 13 },
				{ ...toolMention, from: 18, to: 25 },
			],
			recipe: {
				slug: weeklyRecapRecipe.slug,
				name: weeklyRecapRecipe.name,
			},
			recipeOnly: false,
			recipeSlug: weeklyRecapRecipe.slug,
		});
	});

	it("uses the recipe name for a recipe-only message and rebuilds an editable draft", () => {
		const draft = "@Weekly recap";
		const submission = prepareChatComposerSubmission({
			draft,
			mentions: [
				createMention({
					draft,
					id: weeklyRecapRecipe.slug,
					label: weeklyRecapRecipe.name,
					type: "recipe",
				}),
			],
			recipes: [weeklyRecapRecipe],
		});

		expect(submission.displayText).toBe("Weekly recap");
		expect(submission.messageText).toBe("");
		expect(submission.recipeOnly).toBe(true);
		expect(
			createChatComposerEditDraft({
				mentionPositions: submission.mentionPositions,
				recipe: submission.recipe,
				text: submission.messageText,
			}),
		).toEqual({
			text: "@Weekly recap",
			mentions: [
				{
					id: "weekly-recap",
					label: "Weekly recap",
					from: 0,
					to: 13,
					type: "recipe",
				},
			],
		});
	});

	it("uses explicit mention kinds without ID-based compatibility behavior", () => {
		const draft = "@App-shaped note @Notion @Weekly recap";
		const noteMention = createMention({
			draft,
			id: "app:not-a-tool",
			label: "App-shaped note",
			type: "note",
		});
		const toolMention = createMention({
			draft,
			id: "source-1",
			label: "Notion",
			type: "tool",
			provider: "notion",
		});
		const recipeMention = createMention({
			draft,
			id: weeklyRecapRecipe.slug,
			label: weeklyRecapRecipe.name,
			type: "recipe",
		});

		expect(
			getWorkspaceChatMentionContext([noteMention, toolMention, recipeMention]),
		).toEqual({
			mentionIds: ["app:not-a-tool"],
			requestSelectedSourceIds: ["source-1"],
			recipeSlug: weeklyRecapRecipe.slug,
		});
	});

	it("fails closed for missing or multiple selected recipes", () => {
		const firstDraft = "@Missing";
		expect(() =>
			prepareChatComposerSubmission({
				draft: firstDraft,
				mentions: [
					createMention({
						draft: firstDraft,
						id: "missing",
						label: "Missing",
						type: "recipe",
					}),
				],
				recipes: [],
			}),
		).toThrow("The selected recipe is no longer available.");

		const multipleDraft = "@Weekly recap @Another";
		expect(() =>
			prepareChatComposerSubmission({
				draft: multipleDraft,
				mentions: [
					createMention({
						draft: multipleDraft,
						id: weeklyRecapRecipe.slug,
						label: weeklyRecapRecipe.name,
						type: "recipe",
					}),
					createMention({
						draft: multipleDraft,
						id: "another",
						label: "Another",
						type: "recipe",
					}),
				],
				recipes: [weeklyRecapRecipe],
			}),
		).toThrow("A chat message can use only one recipe.");
	});

	it("rejects malformed composer mention state instead of dropping it", () => {
		expect(() =>
			createChatComposerDocument("@Roadmap", [
				{
					id: "note-1",
					label: "Roadmap",
					from: 1,
					to: 9,
					type: "note",
				},
			]),
		).toThrow("Chat composer mention ranges do not match the draft.");

		expect(() =>
			getChatComposerMentions({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "mention",
								attrs: {
									id: "note-1",
									label: "Roadmap",
								},
							},
						],
					},
				],
			}),
		).toThrow("Chat composer contains an invalid mention kind.");
	});
});
