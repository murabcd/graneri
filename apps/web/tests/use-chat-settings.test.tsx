import { act, cleanup, renderHook } from "@testing-library/react";
import { CHAT_MODE } from "@workspace/ai/chat-mode";
import {
	type ChatSettings,
	DEFAULT_CHAT_SETTINGS,
	parseChatSettings,
} from "@workspace/ai/chat-settings";
import type { OptimisticLocalStore } from "convex/browser";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	useChatSettings,
	useNoteChatSettings,
} from "@/hooks/use-chat-settings";
import type { Id } from "../../../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
	persistChatSettings: vi.fn(async (_args: unknown) => null),
	persistRememberedSettings: vi.fn(async (_args: unknown) => null),
	rememberedSettings: undefined as ChatSettings | undefined,
}));

vi.mock("convex/react", () => ({
	useMutation: (reference: FunctionReference<"mutation">) => {
		const mutation =
			getFunctionName(reference) === "chatPreferences:set"
				? mocks.persistRememberedSettings
				: mocks.persistChatSettings;
		return Object.assign(mutation, {
			withOptimisticUpdate:
				(
					update: (
						localStore: OptimisticLocalStore,
						args: { settings: ChatSettings },
					) => void,
				) =>
				(args: { settings: ChatSettings }) => {
					const localStore: OptimisticLocalStore = {
						getAllQueries: () => [],
						getQuery: () => undefined,
						setQuery: (query, _queryArgs, value) => {
							if (getFunctionName(query) !== "chatPreferences:get") {
								return;
							}
							const settings = parseChatSettings(value);
							if (settings) {
								mocks.rememberedSettings = settings;
							}
						},
					};
					update(localStore, args);
					return mutation(args);
				},
		});
	},
	useQuery: () => mocks.rememberedSettings,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;

afterEach(() => {
	cleanup();
	mocks.persistChatSettings.mockClear();
	mocks.persistRememberedSettings.mockClear();
	mocks.rememberedSettings = undefined;
});

describe("chat settings ownership", () => {
	it("remembers draft changes for each new chat", () => {
		mocks.rememberedSettings = DEFAULT_CHAT_SETTINGS;
		const hook = renderHook(
			({ chatId }: { chatId: string }) =>
				useChatSettings({
					chatId,
					storedSettings: null,
					workspaceId,
				}),
			{
				initialProps: { chatId: "draft-1" },
			},
		);

		expect(hook.result.current.settings).toEqual(DEFAULT_CHAT_SETTINGS);
		act(() => {
			hook.result.current.updateSettings({ chatMode: CHAT_MODE.PLAN });
			hook.result.current.updateSettings({ webSearchEnabled: true });
		});
		hook.rerender({ chatId: "draft-1" });
		expect(hook.result.current.settings).toMatchObject({
			chatMode: CHAT_MODE.PLAN,
			webSearchEnabled: true,
		});
		expect(mocks.persistRememberedSettings).toHaveBeenLastCalledWith({
			settings: {
				...DEFAULT_CHAT_SETTINGS,
				chatMode: CHAT_MODE.PLAN,
				webSearchEnabled: true,
			},
		});
		expect(mocks.persistChatSettings).not.toHaveBeenCalled();

		hook.rerender({ chatId: "draft-2" });
		expect(hook.result.current.settings).toEqual({
			...DEFAULT_CHAT_SETTINGS,
			chatMode: CHAT_MODE.PLAN,
			webSearchEnabled: true,
		});
	});

	it("loads remembered settings after remount", () => {
		const rememberedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-luna",
			reasoningEffort: "high",
			serviceTier: "priority",
			webSearchEnabled: true,
		};
		mocks.rememberedSettings = rememberedSettings;

		const firstMount = renderHook(() =>
			useChatSettings({
				chatId: "draft-1",
				storedSettings: null,
				workspaceId,
			}),
		);
		expect(firstMount.result.current.settings).toEqual(rememberedSettings);
		firstMount.unmount();

		const secondMount = renderHook(() =>
			useChatSettings({
				chatId: "draft-2",
				storedSettings: null,
				workspaceId,
			}),
		);
		expect(secondMount.result.current.settings).toEqual(rememberedSettings);
	});

	it("keeps a stored chat authoritative and makes its changes the next default", () => {
		mocks.rememberedSettings = DEFAULT_CHAT_SETTINGS;
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
				initialProps: { chatId: "stored-1", stored: storedChat },
			},
		);

		expect(hook.result.current.settings).toEqual(storedSettings);
		act(() => {
			hook.result.current.updateSettings({ reasoningEffort: "xhigh" });
		});
		expect(mocks.persistChatSettings).toHaveBeenCalledWith({
			chatId: "stored-1",
			nextChatSettings: {
				...storedSettings,
				reasoningEffort: "xhigh",
			},
			settings: {
				...storedSettings,
				reasoningEffort: "xhigh",
			},
			workspaceId,
		});
		expect(mocks.persistRememberedSettings).not.toHaveBeenCalled();

		hook.rerender({ chatId: "draft-2", stored: null });
		expect(hook.result.current.settings).toEqual({
			...storedSettings,
			reasoningEffort: "xhigh",
		});
	});

	it("projects stored documents to the five-field mutation contract", () => {
		mocks.rememberedSettings = DEFAULT_CHAT_SETTINGS;
		const storedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-luna",
			reasoningEffort: "low",
			serviceTier: "priority",
			webSearchEnabled: true,
		};
		const storedChat = {
			...storedSettings,
			_creationTime: 1,
			_id: "chat-1" as Id<"chats">,
			title: "Stored chat",
		};
		const hook = renderHook(() =>
			useChatSettings({
				chatId: "stored-1",
				storedSettings: storedChat,
				workspaceId,
			}),
		);

		act(() => {
			hook.result.current.updateSettings({ webSearchEnabled: false });
		});

		expect(mocks.persistChatSettings).toHaveBeenCalledWith({
			chatId: "stored-1",
			nextChatSettings: {
				...storedSettings,
				webSearchEnabled: false,
			},
			settings: {
				...storedSettings,
				webSearchEnabled: false,
			},
			workspaceId,
		});
	});

	it("keeps hidden note capabilities disabled without forgetting Ask AI defaults", () => {
		const rememberedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-sol",
			reasoningEffort: "low",
			serviceTier: "auto",
			webSearchEnabled: true,
		};
		mocks.rememberedSettings = rememberedSettings;
		const hook = renderHook(() =>
			useNoteChatSettings({
				chatId: "note-draft",
				noteId: "note-1" as Id<"notes">,
				storedSettings: null,
				workspaceId,
			}),
		);

		expect(hook.result.current.settings).toEqual({
			...rememberedSettings,
			chatMode: CHAT_MODE.DEFAULT,
			webSearchEnabled: false,
		});

		act(() => {
			hook.result.current.updateSettings({
				model: "gpt-5.6-luna",
				reasoningEffort: "high",
				serviceTier: "priority",
			});
		});

		expect(mocks.persistRememberedSettings).toHaveBeenCalledWith({
			settings: {
				...rememberedSettings,
				model: "gpt-5.6-luna",
				reasoningEffort: "high",
				serviceTier: "priority",
			},
		});
	});

	it("persists a canonical note snapshot and separate next-chat defaults", () => {
		const rememberedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-sol",
			reasoningEffort: "low",
			serviceTier: "auto",
			webSearchEnabled: true,
		};
		mocks.rememberedSettings = rememberedSettings;
		const storedSettings: ChatSettings = {
			chatMode: CHAT_MODE.PLAN,
			model: "gpt-5.6-terra",
			reasoningEffort: "medium",
			serviceTier: "priority",
			webSearchEnabled: true,
		};
		const hook = renderHook(() =>
			useNoteChatSettings({
				chatId: "note-chat",
				noteId: "note-1" as Id<"notes">,
				storedSettings,
				workspaceId,
			}),
		);

		act(() => {
			hook.result.current.updateSettings({ reasoningEffort: "xhigh" });
		});

		expect(mocks.persistChatSettings).toHaveBeenCalledWith({
			chatId: "note-chat",
			nextChatSettings: {
				...rememberedSettings,
				model: "gpt-5.6-terra",
				reasoningEffort: "xhigh",
				serviceTier: "priority",
			},
			settings: {
				chatMode: CHAT_MODE.DEFAULT,
				model: "gpt-5.6-terra",
				reasoningEffort: "xhigh",
				serviceTier: "priority",
				webSearchEnabled: false,
			},
			workspaceId,
		});
	});
});
