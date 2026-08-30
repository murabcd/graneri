import { useConvex } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { downloadUrlAsFile } from "@/lib/download-file";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";

export const useNoteFileDownload = () => {
	const convex = useConvex();

	return React.useCallback(
		async (noteAttachmentId: string) => {
			try {
				const attachment = await convex.query(api.notes.getAttachment, {
					id: noteAttachmentId,
				});
				if (!attachment) {
					throw new Error("The file is no longer available.");
				}
				await downloadUrlAsFile({
					filename: attachment.filename,
					url: attachment.url,
				});
			} catch (error) {
				logError({
					error,
					event: "note_file.download_failed",
				});
				toast.error("Failed to download file");
				throw error;
			}
		},
		[convex],
	);
};
