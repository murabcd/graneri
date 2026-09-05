import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHistoryList } from "@/components/chat/chat-history-list";
import { ActiveWorkspaceProvider } from "@/hooks/active-workspace-provider";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const { mutationMock } = vi.hoisted(() => {
	const mutation = vi.fn();
	return {
		mutationMock: Object.assign(mutation, {
			withOptimisticUpdate: () => mutation,
		}),
	};
});

vi.mock("convex/react", () => ({
	useMutation: () => mutationMock,
}));

const workspaceId = "workspace-id" as Id<"workspaces">;
const chat = {
	_id: "chat-document-id" as Id<"chats">,
	_creationTime: 1_000,
	ownerTokenIdentifier: "test|owner",
	workspaceId,
	chatId: "chat-client-id",
	starredSortOrder: 1_000,
	title: "Unread response",
	preview: "Prompt",
	unreadAssistantCompletedAt: 2_000,
	isArchived: false,
	createdAt: 1_000,
	updatedAt: 2_000,
	lastMessageAt: 2_000,
} satisfies Doc<"chats">;

const renderHistory = (activeChatId: string | null) =>
	render(
		<ActiveWorkspaceProvider workspaceId={workspaceId}>
			<ChatHistoryList
				chats={[chat]}
				isChatsLoading={false}
				activeChatId={activeChatId}
				onOpenChat={vi.fn()}
				onMoveToTrash={vi.fn()}
			/>
		</ActiveWorkspaceProvider>,
	);

describe("chat unread response indicator", () => {
	afterEach(() => cleanup());

	it("shows for an unread history row", () => {
		renderHistory(null);

		expect(screen.getByLabelText("Unread AI response")).not.toBeNull();
	});

	it("is suppressed immediately for the active chat", () => {
		renderHistory(chat.chatId);

		expect(screen.queryByLabelText("Unread AI response")).toBeNull();
	});
});
