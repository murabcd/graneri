import type { Editor, EditorEvents } from "@tiptap/core";

export const trackNoteUploadPosition = (
	editor: Editor,
	requestedPosition: number,
) => {
	let position = Math.min(requestedPosition, editor.state.doc.content.size);
	const trackPosition = ({ transaction }: EditorEvents["transaction"]) => {
		position = transaction.mapping.map(position, 1);
	};
	editor.on("transaction", trackPosition);

	return {
		read: () => position,
		stop: () => editor.off("transaction", trackPosition),
	};
};
