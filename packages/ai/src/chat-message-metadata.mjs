import { z } from "zod";
import { isChatAppSourceProvider } from "./capability-metadata.mjs";

const mentionRangeSchema = z
	.strictObject({
		from: z.number().int().nonnegative(),
		id: z.string(),
		label: z.string(),
		to: z.number().int().positive(),
	})
	.refine(({ from, to }) => to > from);

const noteMentionSchema = mentionRangeSchema.extend({
	type: z.literal("note"),
});

const toolMentionSchema = mentionRangeSchema.extend({
	provider: z.custom(isChatAppSourceProvider),
	type: z.literal("tool"),
});

const chatRecipeReceiptSchema = z.strictObject({
	name: z.string().min(1),
	slug: z.string().min(1),
});

const chatMessageMetadataSchema = z
	.strictObject({
		interrupted: z.boolean().optional(),
		mentionPositions: z
			.array(z.union([noteMentionSchema, toolMentionSchema]))
			.optional(),
		recipe: chatRecipeReceiptSchema.optional(),
		recipeOnly: z.boolean().optional(),
	})
	.superRefine((metadata, context) => {
		if (
			(metadata.recipe !== undefined) !==
			(metadata.recipeOnly !== undefined)
		) {
			context.addIssue({
				code: "custom",
				message: "Recipe metadata requires an explicit recipeOnly value.",
			});
		}
	});

export const parseChatMessageMetadata = (value) => {
	const result = chatMessageMetadataSchema.safeParse(value);
	return result.success ? result.data : null;
};
