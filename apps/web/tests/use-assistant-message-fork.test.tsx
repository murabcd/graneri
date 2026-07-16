import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantMessageFork } from "../src/hooks/use-assistant-message-fork";

const { forkMutation, logError, toastError } = vi.hoisted(() => ({
	forkMutation: vi.fn(),
	logError: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => forkMutation,
}));

vi.mock("sonner", () => ({
	toast: { error: toastError },
}));

vi.mock("@/lib/logger", () => ({
	logError,
}));

describe("useAssistantMessageFork", () => {
	beforeEach(() => {
		forkMutation.mockReset();
		logError.mockReset();
		toastError.mockReset();
	});

	it("creates an immutable fork and reports its chat id", async () => {
		const onForked = vi.fn();
		const { result } = renderHook(() =>
			useAssistantMessageFork({
				workspaceId: "workspace-1" as never,
				chatId: "source-chat",
				onForked,
			}),
		);

		await act(async () => {
			await result.current("assistant-1");
		});

		expect(forkMutation).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			chatId: "source-chat",
			messageId: "assistant-1",
			forkChatId: expect.any(String),
		});
		const forkChatId = forkMutation.mock.calls[0]?.[0]?.forkChatId;
		expect(onForked).toHaveBeenCalledWith(forkChatId);
	});

	it("keeps the current chat selected when forking fails", async () => {
		const error = new Error("fork failed");
		forkMutation.mockRejectedValueOnce(error);
		const onForked = vi.fn();
		const { result } = renderHook(() =>
			useAssistantMessageFork({
				workspaceId: "workspace-1" as never,
				chatId: "source-chat",
				onForked,
			}),
		);

		await act(async () => {
			await result.current("assistant-1");
		});

		expect(onForked).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith(expect.objectContaining({ error }));
		expect(toastError).toHaveBeenCalledWith("Failed to continue in a new chat");
	});
});
