import { act, renderHook, waitFor } from "@testing-library/react";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSharedLocalFolderSession } from "@/hooks/use-shared-local-folder-session";
import { storeSharedLocalFolders } from "@/lib/local-folder-sharing";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("shared local folder session", () => {
	it("keeps hydration and reconciliation scoped to the current chat", async () => {
		const folderA = {
			id: "folder_a",
			name: "a",
			path: "/Users/test/Documents/a",
		};
		const folderB = {
			id: "folder_b",
			name: "b",
			path: "/Users/test/Documents/b",
		};
		const folderC = {
			id: "folder_c",
			name: "c",
			path: "/Users/test/Documents/c",
		};
		storeSharedLocalFolders("chat:a", [folderA]);
		storeSharedLocalFolders("chat:b", [folderB]);

		const resolvers = new Map<
			string,
			(value: { folders: DesktopLocalFolder[] }) => void
		>();
		const shareLocalFolders = vi.fn(
			(paths: string[]) =>
				new Promise<{ folders: DesktopLocalFolder[] }>((resolve) => {
					resolvers.set(paths[0], resolve);
				}),
		);
		window.graneriDesktop = {
			platform: "darwin",
			shareLocalFolders,
		} as Window["graneriDesktop"];

		const { result, rerender } = renderHook(
			({ scope }) => useSharedLocalFolderSession(scope),
			{ initialProps: { scope: "chat:a" } },
		);
		await waitFor(() => expect(shareLocalFolders).toHaveBeenCalledTimes(1));

		rerender({ scope: "chat:b" });
		expect(result.current.sharedLocalFolders).toEqual([]);
		await waitFor(() => expect(shareLocalFolders).toHaveBeenCalledTimes(2));

		act(() => result.current.reconcileSharedLocalFolders([folderC]));
		expect(result.current.sharedLocalFolders).toEqual([folderC]);

		await act(async () => {
			resolvers.get(folderB.path)?.({ folders: [folderB] });
		});
		expect(result.current.sharedLocalFolders).toEqual([folderC]);

		await act(async () => {
			resolvers.get(folderA.path)?.({ folders: [folderA] });
		});
		expect(result.current.sharedLocalFolders).toEqual([folderC]);
	});

	it("chooses, replaces, and removes one folder through the desktop picker", async () => {
		const folder = {
			id: "folder_graneri",
			name: "graneri",
			path: "/Users/test/Documents/graneri",
		};
		const replacementFolder = {
			id: "folder_fluently",
			name: "fluently",
			path: "/Users/test/Documents/fluently",
		};
		const pickLocalFolder = vi
			.fn()
			.mockResolvedValueOnce({ canceled: false, folder })
			.mockResolvedValueOnce({
				canceled: false,
				folder: replacementFolder,
			});
		const shareLocalFolders = vi.fn().mockResolvedValue({ folders: [] });
		window.graneriDesktop = {
			platform: "darwin",
			pickLocalFolder,
			shareLocalFolders,
		} as Window["graneriDesktop"];

		const { result } = renderHook(() =>
			useSharedLocalFolderSession("chat:graneri"),
		);

		await act(async () => result.current.chooseSharedLocalFolder());
		expect(pickLocalFolder).toHaveBeenCalledWith();
		expect(result.current.sharedLocalFolders).toEqual([folder]);
		expect(
			JSON.parse(
				window.localStorage.getItem(
					"graneri.sharedLocalFolders.chat:graneri",
				) ?? "null",
			),
		).toEqual([folder]);

		await act(async () => result.current.chooseSharedLocalFolder());
		expect(result.current.sharedLocalFolders).toEqual([replacementFolder]);

		await act(async () => result.current.clearSharedLocalFolderSelection());
		expect(shareLocalFolders).toHaveBeenCalledWith([]);
		expect(result.current.sharedLocalFolders).toEqual([]);
	});
});
