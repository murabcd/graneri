import { useMutation } from "convex/react";
import * as React from "react";
import type { LocalImageStorage } from "@/lib/desktop-local-tool-call";
import { api } from "../../../../convex/_generated/api";

export const useLocalImageStorage = (): LocalImageStorage => {
	const generateUploadUrl = useMutation(api.chatAttachments.generateUploadUrl);
	const getUrl = useMutation(api.chatAttachments.getUrl);

	return React.useMemo(
		() => ({
			generateUploadUrl: async () => await generateUploadUrl(),
			getUrl: async (storageId) => await getUrl({ storageId }),
		}),
		[generateUploadUrl, getUrl],
	);
};
