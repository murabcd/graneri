import { getCachedConvexToken } from "@/lib/convex-token";

export const prepareChatReconnectToStreamRequest = async ({
	streamApiUrl,
	workspaceId,
}: {
	streamApiUrl: string;
	workspaceId: string | null;
}) => {
	if (!workspaceId) {
		throw new Error("Cannot resume chat stream without a workspace.");
	}

	const convexToken = await getCachedConvexToken();
	if (!convexToken) {
		throw new Error("Cannot resume chat stream without authentication.");
	}

	const reconnectUrl = new URL(streamApiUrl, window.location.origin);
	reconnectUrl.searchParams.set("workspaceId", workspaceId);

	return {
		api: reconnectUrl.toString(),
		headers: {
			Authorization: `Bearer ${convexToken}`,
		},
	};
};
