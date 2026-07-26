import { describe, expect, it } from "vitest";
import { defaultChatModel } from "@/lib/ai/models";
import { buildWorkspaceChatRequestBodyFromLocalFolders } from "@/lib/chat-request-preparation";

describe("workspace chat request preparation", () => {
	it("carries the selected recipe through the canonical workspace request", async () => {
		const request = await buildWorkspaceChatRequestBodyFromLocalFolders({
			localFolders: [],
			mentions: ["note-1"],
			model: defaultChatModel.model,
			recipeSlug: "write-weekly-recap",
			reasoningEffort: "high",
			resolveConvexToken: async () => "convex-token",
			selectedSourceIds: ["app:notion"],
			serviceTier: "priority",
			webSearchEnabled: false,
			workspaceId: "workspace-1",
		});

		expect(request).toMatchObject({
			convexToken: "convex-token",
			mentions: ["note-1"],
			recipeSlug: "write-weekly-recap",
			selectedSourceIds: ["app:notion"],
			serviceTier: "priority",
			workspaceId: "workspace-1",
		});
	});
});
