import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { describe, expect, it } from "vitest";
import {
	buildNoteChatRequestBodyFromLocalFolders,
	buildWorkspaceChatRequestBodyFromLocalFolders,
} from "@/lib/chat-request-preparation";

describe("workspace chat request preparation", () => {
	it("carries the selected recipe through the canonical workspace request", async () => {
		const request = await buildWorkspaceChatRequestBodyFromLocalFolders({
			localFolders: [],
			mentions: ["note-1"],
			projectId: "project-1",
			recipeSlug: "write-weekly-recap",
			resolveConvexToken: async () => "convex-token",
			selectedSourceIds: ["app:notion"],
			settings: {
				...DEFAULT_CHAT_SETTINGS,
				chatMode: CHAT_MODE.PLAN,
				reasoningEffort: "high",
				serviceTier: "priority",
			},
			workspaceId: "workspace-1",
		});

		expect(request).toMatchObject({
			chatMode: CHAT_MODE.PLAN,
			convexToken: "convex-token",
			mentions: ["note-1"],
			projectId: "project-1",
			recipeSlug: "write-weekly-recap",
			selectedSourceIds: ["app:notion"],
			serviceTier: "priority",
			workspaceId: "workspace-1",
		});
	});

	it("keeps a note chat's mode and web setting in its request", async () => {
		const request = await buildNoteChatRequestBodyFromLocalFolders({
			localFolders: [],
			noteContext: {
				noteId: "note-1",
				title: "Meeting notes",
				text: "Decisions",
			},
			recipeSlug: null,
			resolveConvexToken: async () => null,
			settings: {
				...DEFAULT_CHAT_SETTINGS,
				chatMode: CHAT_MODE.PLAN,
				webSearchEnabled: true,
			},
		});

		expect(request.chatMode).toBe(CHAT_MODE.PLAN);
		expect(request.webSearchEnabled).toBe(true);
	});
});
