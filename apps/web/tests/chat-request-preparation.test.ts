import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildNoteChatRequestBody,
	buildWorkspaceChatRequestBody,
} from "@/lib/chat-request-preparation";

const { authorizeLocalCapabilityFromText, getLocalCapabilitySession } =
	vi.hoisted(() => ({
		authorizeLocalCapabilityFromText: vi.fn(),
		getLocalCapabilitySession: vi.fn(),
	}));

vi.mock("@/lib/local-capability-session", () => ({
	authorizeLocalCapabilityFromText,
	getLocalCapabilitySession,
}));

describe("workspace chat request preparation", () => {
	beforeEach(() => {
		getLocalCapabilitySession.mockReset();
		authorizeLocalCapabilityFromText.mockReset();
	});

	it("carries the selected recipe through the canonical workspace request", async () => {
		const request = await buildWorkspaceChatRequestBody({
			localCapability: {
				source: "session",
				session: {
					id: "capability-1",
					label: "graneri",
				},
			},
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
			localCapabilitySession: {
				id: "capability-1",
				label: "graneri",
			},
		});
		expect(getLocalCapabilitySession).not.toHaveBeenCalled();
		expect(authorizeLocalCapabilityFromText).not.toHaveBeenCalled();
	});

	it("keeps a note chat's mode and web setting in its request", async () => {
		const request = await buildNoteChatRequestBody({
			localCapability: { source: "session", session: null },
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

	it("authorizes message references before constructing the request", async () => {
		getLocalCapabilitySession.mockResolvedValue({
			id: "capability-old",
			label: "old",
		});
		authorizeLocalCapabilityFromText.mockResolvedValue({
			id: "capability-new",
			label: "graneri",
		});

		const request = await buildNoteChatRequestBody({
			localCapability: {
				source: "message",
				scope: "note-chat:chat-1",
				text: "Read /workspace/README.md",
			},
			noteContext: {
				noteId: "note-1",
				title: "Meeting notes",
				text: "Decisions",
			},
			recipeSlug: null,
			resolveConvexToken: async () => "convex-token",
			settings: DEFAULT_CHAT_SETTINGS,
		});

		expect(getLocalCapabilitySession).toHaveBeenCalledWith("note-chat:chat-1");
		expect(authorizeLocalCapabilityFromText).toHaveBeenCalledWith({
			currentSession: { id: "capability-old", label: "old" },
			scope: "note-chat:chat-1",
			text: "Read /workspace/README.md",
		});
		expect(request.localCapabilitySession).toEqual({
			id: "capability-new",
			label: "graneri",
		});
	});
});
