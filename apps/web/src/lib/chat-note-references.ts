import { type NoteReadResult, noteReadSchema } from "@workspace/ai/note-tools";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export type ReadNoteReference = Pick<
	NonNullable<NoteReadResult>,
	"noteId" | "title" | "project"
>;

export function extractReadNoteReferences(
	message: UIMessage,
): ReadNoteReference[] {
	if (message.role !== "assistant") return [];
	const notes = new Map<string, ReadNoteReference>();
	for (const part of message.parts) {
		if (
			!isToolUIPart(part) ||
			part.state !== "output-available" ||
			getToolName(part) !== "get_note"
		)
			continue;
		const result = noteReadSchema.safeParse(part.output);
		if (result.success) {
			const { noteId, title, project } = result.data;
			notes.set(noteId, { noteId, title, project });
		}
	}
	return [...notes.values()];
}
