import { act, cleanup, renderHook } from "@testing-library/react";
import { CHAT_MODE } from "@workspace/ai/chat-mode";
import {
	type ChatSettings,
	DEFAULT_CHAT_SETTINGS,
} from "@workspace/ai/chat-settings";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSettings } from "@/hooks/use-chat-settings";
import type { Id } from "../../../convex/_generated/dataModel";

const { persistSettings } = vi.hoisted(() => ({
	persistSettings: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
	useMutation: () => persistSettings,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;

afterEach(() => {
	cleanup();
	persistSettings.mockClear();
});

describe("per-chat settings", () => {
	it("keeps draft changes scoped and restores stored chats", () => {
		const storedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-terra",
			reasoningEffort: "high",
			serviceTier: "priority",
			webSearchEnabled: true,
		};
		const storedChat = {
			...storedSettings,
			_creationTime: 1,
			_id: "chat-1" as Id<"chats">,
			title: "Stored chat",
		};
		const hook = renderHook(
			({ chatId, stored }: { chatId: string; stored: ChatSettings | null }) =>
				useChatSettings({
					chatId,
					storedSettings: stored,
					workspaceId,
				}),
			{
				initialProps: { chatId: "draft-1", stored: null },
			},
		);

		expect(hook.result.current.settings).toEqual(DEFAULT_CHAT_SETTINGS);
		act(() => {
			hook.result.current.updateSettings({ chatMode: CHAT_MODE.PLAN });
			hook.result.current.updateSettings({ webSearchEnabled: true });
		});
		expect(hook.result.current.settings).toMatchObject({
			chatMode: CHAT_MODE.PLAN,
			webSearchEnabled: true,
		});
		expect(persistSettings).not.toHaveBeenCalled();

		hook.rerender({ chatId: "stored-1", stored: storedChat });
		expect(hook.result.current.settings).toEqual(storedSettings);

		act(() => {
			hook.result.current.updateSettings({ reasoningEffort: "xhigh" });
		});
		expect(persistSettings).toHaveBeenCalledWith({
			chatId: "stored-1",
			settings: {
				...storedSettings,
				reasoningEffort: "xhigh",
			},
			workspaceId,
		});

		hook.rerender({ chatId: "draft-2", stored: null });
		expect(hook.result.current.settings).toEqual(DEFAULT_CHAT_SETTINGS);
	});

	it("restores all five settings after remount", () => {
		const storedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-luna",
			reasoningEffort: "low",
			serviceTier: "priority",
			webSearchEnabled: true,
		};
		const firstMount = renderHook(() =>
			useChatSettings({
				chatId: "stored-1",
				storedSettings,
				workspaceId,
			}),
		);
		expect(firstMount.result.current.settings).toEqual(storedSettings);
		firstMount.unmount();

		const secondMount = renderHook(() =>
			useChatSettings({
				chatId: "stored-1",
				storedSettings,
				workspaceId,
			}),
		);
		expect(secondMount.result.current.settings).toEqual(storedSettings);
	});
});
