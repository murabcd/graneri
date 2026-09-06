import { useMutation } from "convex/react";
import * as React from "react";
import type { LocalFileStorage } from "@/lib/desktop-local-tool-call";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useLocalFileStorage = ({
	chatId,
	workspaceId,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null;
}): LocalFileStorage => {
	const generateUploadUrl = useMutation(api.chatAttachments.generateUploadUrl);
	const getUrl = useMutation(api.chatAttachments.getUrl);
	const getOwnedUrl = useMutation(api.chatAttachments.getOwnedUrl);

	return React.useMemo(
		() => ({
			generateUploadUrl: async () => await generateUploadUrl(),
			getUrl: async (storageId) => await getUrl({ storageId }),
			getOwnedUrl: async (storageId) =>
				workspaceId
					? await getOwnedUrl({ chatId, workspaceId, storageId })
					: null,
		}),
		[chatId, generateUploadUrl, getOwnedUrl, getUrl, workspaceId],
	);
};
