import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { commitCurrentNoteDocument, parseNoteDocument } from "./noteDocument";

const EMPTY_TEST_NOTE_DOCUMENT = JSON.stringify({
	type: "doc",
	content: [{ type: "paragraph" }],
});

type TestNoteFields = Omit<
	WithoutSystemFields<Doc<"notes">>,
	"content" | "searchableText"
> & {
	content?: string;
	searchableText?: string;
};

export const insertTestNote = async (
	ctx: MutationCtx,
	{
		content = EMPTY_TEST_NOTE_DOCUMENT,
		searchableText = "",
		...noteFields
	}: TestNoteFields,
): Promise<Id<"notes">> => {
	const noteId = await ctx.db.insert("notes", noteFields);
	const note = await ctx.db.get(noteId);
	if (!note) {
		throw new Error("Inserted test note is unavailable.");
	}
	await commitCurrentNoteDocument({
		ctx,
		note,
		document: parseNoteDocument(content),
		searchableText,
		now: note.updatedAt,
	});
	return noteId;
};
