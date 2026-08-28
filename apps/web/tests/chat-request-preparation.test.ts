import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { describe, expect, it } from "vitest";
import { defaultChatModel } from "@/lib/ai/models";
import {
	buildNoteChatRequestBodyFromLocalFolders,
	buildWorkspaceChatRequestBodyFromLocalFolders,
} from "@/lib/chat-request-preparation";

describe("workspace chat request preparation", () => {
	it("carries the selected recipe through the canonical workspace request", async () => {
		const request = await buildWorkspaceChatRequestBodyFromLocalFolders({
			chatMode: CHAT_MODE.PLAN,
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
			chatMode: CHAT_MODE.PLAN,
			convexToken: "convex-token",
			mentions: ["note-1"],
			recipeSlug: "write-weekly-recap",
			selectedSourceIds: ["app:notion"],
			serviceTier: "priority",
			workspaceId: "workspace-1",
		});
	});

	it("uses the canonical default mode for note chat requests", async () => {
		const request = await buildNoteChatRequestBodyFromLocalFolders({
			localFolders: [],
			model: defaultChatModel.model,
			noteContext: {
				noteId: "note-1",
				title: "Meeting notes",
				text: "Decisions",
			},
			recipeSlug: null,
			reasoningEffort: "medium",
			resolveConvexToken: async () => null,
			serviceTier: "auto",
		});

		expect(request.chatMode).toBe(CHAT_MODE.DEFAULT);
	});
});
