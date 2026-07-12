import { afterEach, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	groupNoteChatsForSelector,
	type NoteChatSummary,
} from "../src/hooks/use-note-discussion-session";

const createChat = ({
	chatId,
	updatedAt,
}: {
	chatId: string;
	updatedAt: number;
}): NoteChatSummary => ({
	_id: chatId as Id<"chats">,
	_creationTime: updatedAt,
	chatId,
	createdAt: updatedAt,
	title: chatId,
	updatedAt,
});

afterEach(() => {
	vi.useRealTimers();
});

it("groups note discussions by the current local calendar day", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 6, 13, 12));
	const today = createChat({
		chatId: "today",
		updatedAt: new Date(2026, 6, 13, 8).getTime(),
	});
	const previous = createChat({
		chatId: "previous",
		updatedAt: new Date(2026, 6, 12, 23, 59).getTime(),
	});

	expect(groupNoteChatsForSelector([today, previous])).toEqual({
		today: [today],
		previous: [previous],
	});
});
