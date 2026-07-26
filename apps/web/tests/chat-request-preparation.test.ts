import { describe, expect, it } from "vitest";
import { buildWorkspaceChatRequestBodyFromLocalFolders } from "@/lib/chat-request-preparation";

describe("workspace chat request preparation", () => {
	it("carries the selected recipe through the canonical workspace request", async () => {
		const request = await buildWorkspaceChatRequestBodyFromLocalFolders({
			localFolders: [],
			mentions: ["note-1"],
			model: "gpt-5.4",
			recipeSlug: "write-weekly-recap",
			reasoningEffort: "high",
			resolveConvexToken: async () => "convex-token",
			selectedSourceIds: ["app:notion"],
			webSearchEnabled: false,
			workspaceId: "workspace-1",
		});

		expect(request).toMatchObject({
			convexToken: "convex-token",
			mentions: ["note-1"],
			recipeSlug: "write-weekly-recap",
			selectedSourceIds: ["app:notion"],
			workspaceId: "workspace-1",
		});
	});
});
