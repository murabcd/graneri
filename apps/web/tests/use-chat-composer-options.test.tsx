import { act, cleanup, renderHook } from "@testing-library/react";
import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useChatComposerOptions } from "@/hooks/use-chat-composer-options";
import { buildWorkspaceChatRequestBodyFromLocalFolders } from "@/lib/chat-request-preparation";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	cleanup();
});

describe("chat composer options", () => {
	it("restores active options after remount and keeps them in the request", async () => {
		const firstMount = renderHook(useChatComposerOptions);
		expect(firstMount.result.current.webSearchEnabled).toBe(false);
		expect(firstMount.result.current.chatMode).toBe(CHAT_MODE.DEFAULT);

		act(() => {
			firstMount.result.current.setWebSearchEnabled(true);
			firstMount.result.current.setChatMode(CHAT_MODE.PLAN);
		});
		firstMount.unmount();

		const secondMount = renderHook(useChatComposerOptions);
		expect(secondMount.result.current.webSearchEnabled).toBe(true);
		expect(secondMount.result.current.chatMode).toBe(CHAT_MODE.PLAN);

		const request = await buildWorkspaceChatRequestBodyFromLocalFolders({
			chatMode: secondMount.result.current.chatMode,
			localFolders: [],
			mentions: [],
			model: "gpt-5.6-sol",
			recipeSlug: null,
			reasoningEffort: "low",
			resolveConvexToken: async () => null,
			selectedSourceIds: [],
			serviceTier: "auto",
			webSearchEnabled: secondMount.result.current.webSearchEnabled,
			workspaceId: "workspace-1",
		});
		expect(request.webSearchEnabled).toBe(true);
		expect(request.chatMode).toBe(CHAT_MODE.PLAN);
	});

	it("keeps the controls usable when browser storage is unavailable", () => {
		const unavailableStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("Storage unavailable");
			},
		};
		const composerOptions = renderHook(() =>
			useChatComposerOptions(unavailableStorage),
		);

		act(() => {
			composerOptions.result.current.setWebSearchEnabled(true);
			composerOptions.result.current.setChatMode(CHAT_MODE.PLAN);
		});

		expect(composerOptions.result.current.webSearchEnabled).toBe(true);
		expect(composerOptions.result.current.chatMode).toBe(CHAT_MODE.PLAN);
	});
});
