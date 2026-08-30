import type { FileUIPart } from "ai";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileAttachmentCards } from "@/components/ai-elements/file-attachment-cards";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const toFilePart = (
	attachment: FunctionReturnType<typeof api.notes.listAttachments>[number],
): FileUIPart => ({
	type: "file",
	filename: attachment.filename,
	mediaType: attachment.mediaType,
	providerMetadata: {
		graneri: {
			sizeBytes: attachment.sizeBytes,
			storageId: attachment.storageId,
		},
	},
	url: attachment.url,
});

export function NoteAttachments({ noteId }: { noteId: Id<"notes"> }) {
	const workspaceId = useActiveWorkspaceId();
	const attachments = useQuery(
		api.notes.listAttachments,
		workspaceId ? { id: noteId, workspaceId } : "skip",
	);

	if (!attachments || attachments.length === 0) {
		return null;
	}

	return <FileAttachmentCards files={attachments.map(toFilePart)} />;
}
