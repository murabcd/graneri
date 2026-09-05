import { cleanup, renderHook } from "@testing-library/react";
import type { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePaginatedChatMessages } from "../src/hooks/use-paginated-chat-messages";

type Message = NonNullable<
	FunctionReturnType<typeof api.chatThreads.readMessage>
>;
const state = vi.hoisted(() => ({
	headers: [] as FunctionReturnType<typeof api.chatThreads.readPage>["page"],
	bodies: {} as Record<string, Message | undefined>,
	status: "Exhausted",
	loadMore: vi.fn(),
	queries: vi.fn(),
}));
vi.mock("convex/react", () => ({
	usePaginatedQuery: () => ({
		results: state.headers,
		status: state.status,
		loadMore: state.loadMore,
	}),
	useQuery: () => null,
	useQueries: (queries: Parameters<typeof useQueries>[0]) => {
		state.queries(queries);
		return state.bodies;
	},
}));
const workspaceId = "workspace" as Id<"workspaces">;
const message = (id: string, createdAt: number): Message => ({
	id,
	createdAt,
	role: "assistant",
	text: id,
	partsJson: JSON.stringify([{ type: "text", text: id }]),
});
beforeEach(() => {
	state.headers = [];
	state.bodies = {};
	state.status = "Exhausted";
	vi.clearAllMocks();
});
afterEach(cleanup);

test("renders independently loaded bodies in chronological order and retains loaded history while earlier bodies arrive", () => {
	state.headers = [
		{ id: "new", role: "assistant", createdAt: 3 },
		{ id: "old", role: "assistant", createdAt: 2 },
	];
	const { result, rerender } = renderHook(() =>
		usePaginatedChatMessages({ chatId: "chat", workspaceId }),
	);
	expect(result.current.isLoadingFirstPage).toBe(true);
	state.bodies = { new: message("new", 3) };
	rerender();
	expect(result.current.messages.map((value) => value.id)).toEqual(["new"]);
	expect(result.current.isLoadingFirstPage).toBe(false);
	state.bodies = { ...state.bodies, old: message("old", 2) };
	rerender();
	expect(result.current.messages.map((value) => value.id)).toEqual([
		"old",
		"new",
	]);
	state.headers = [
		...state.headers,
		{ id: "earlier", role: "assistant", createdAt: 1 },
	];
	rerender();
	expect(result.current.isLoadingEarlierMessages).toBe(true);
	expect(result.current.messages.map((value) => value.id)).toEqual([
		"old",
		"new",
	]);
	state.bodies = { ...state.bodies, earlier: message("earlier", 1) };
	rerender();
	expect(result.current.messages.map((value) => value.id)).toEqual([
		"earlier",
		"old",
		"new",
	]);
	expect(result.current.isLoadingEarlierMessages).toBe(false);
});

test("scopes every body subscription to the selected chat and stops subscriptions when closed", () => {
	state.headers = [{ id: "shared-id", role: "assistant", createdAt: 1 }];
	const { rerender } = renderHook(
		({ chatId }: { chatId: string | null }) =>
			usePaginatedChatMessages({ chatId, workspaceId }),
		{ initialProps: { chatId: "first" as string | null } },
	);
	expect(state.queries).toHaveBeenLastCalledWith({
		"shared-id": expect.objectContaining({
			args: { chatId: "first", workspaceId, messageId: "shared-id" },
		}),
	});
	rerender({ chatId: "second" });
	expect(state.queries).toHaveBeenLastCalledWith({
		"shared-id": expect.objectContaining({
			args: { chatId: "second", workspaceId, messageId: "shared-id" },
		}),
	});
	rerender({ chatId: null });
	expect(state.queries).toHaveBeenLastCalledWith({});
});
