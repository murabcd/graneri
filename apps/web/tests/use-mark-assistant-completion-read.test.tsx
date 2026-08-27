import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMarkAssistantCompletionRead } from "@/hooks/use-mark-assistant-completion-read";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const { mutationMock } = vi.hoisted(() => ({
	mutationMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("convex/react", () => ({
	useMutation: () => mutationMock,
}));

const workspaceId = "workspace-id" as Id<"workspaces">;
const unreadChat = {
	chatId: "chat-client-id",
	unreadAssistantCompletedAt: 2_000,
} satisfies Pick<Doc<"chats">, "chatId" | "unreadAssistantCompletedAt">;

afterEach(() => {
	vi.clearAllMocks();
});

describe("useMarkAssistantCompletionRead", () => {
	it("clears the unread completion for the opened chat", async () => {
		renderHook(() =>
			useMarkAssistantCompletionRead({ chat: unreadChat, workspaceId }),
		);

		await waitFor(() => {
			expect(mutationMock).toHaveBeenCalledWith({
				workspaceId,
				chatId: unreadChat.chatId,
			});
		});
	});

	it("does nothing when the opened chat has no unread completion", () => {
		renderHook(() =>
			useMarkAssistantCompletionRead({
				chat: { ...unreadChat, unreadAssistantCompletedAt: undefined },
				workspaceId,
			}),
		);

		expect(mutationMock).not.toHaveBeenCalled();
	});
});
