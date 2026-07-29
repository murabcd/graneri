import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNoteNavigationPreparation } from "../src/hooks/use-note-navigation-preparation";

const { logError, query, toastError } = vi.hoisted(() => ({
	logError: vi.fn(),
	query: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useConvex: () => ({ query }),
}));

vi.mock("sonner", () => ({
	toast: { error: toastError },
}));

vi.mock("@/lib/logger", () => ({
	logError,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const firstNoteId = "note-1" as Id<"notes">;
const secondNoteId = "note-2" as Id<"notes">;

const createDeferred = <T,>() => {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

describe("useNoteNavigationPreparation", () => {
	beforeEach(() => {
		logError.mockReset();
		query.mockReset();
		toastError.mockReset();
	});

	it("prefetches the destination note discussions", async () => {
		query.mockResolvedValue([]);
		const { result } = renderHook(() =>
			useNoteNavigationPreparation({ workspaceId }),
		);

		await expect(result.current.prefetchNote(firstNoteId)).resolves.toBe(true);
		expect(query).toHaveBeenCalledWith(expect.anything(), {
			workspaceId,
			noteId: firstNoteId,
		});
	});

	it("allows only the latest prepared note navigation to continue", async () => {
		const firstQuery = createDeferred<unknown[]>();
		const secondQuery = createDeferred<unknown[]>();
		const onFirstReady = vi.fn();
		const onSecondReady = vi.fn();
		query
			.mockReturnValueOnce(firstQuery.promise)
			.mockReturnValueOnce(secondQuery.promise);
		const { result } = renderHook(() =>
			useNoteNavigationPreparation({ workspaceId }),
		);

		result.current.prepareNoteNavigation(firstNoteId, onFirstReady);
		result.current.prepareNoteNavigation(secondNoteId, onSecondReady);

		await act(async () => {
			secondQuery.resolve([]);
			await secondQuery.promise;
			firstQuery.resolve([]);
			await firstQuery.promise;
		});
		expect(onFirstReady).not.toHaveBeenCalled();
		expect(onSecondReady).toHaveBeenCalledOnce();
	});

	it("cancels pending navigation when another location wins", async () => {
		const pendingQuery = createDeferred<unknown[]>();
		const onReady = vi.fn();
		query.mockReturnValueOnce(pendingQuery.promise);
		const { result } = renderHook(() =>
			useNoteNavigationPreparation({ workspaceId }),
		);
		result.current.prepareNoteNavigation(firstNoteId, onReady);

		result.current.cancelPendingNoteNavigation();
		await act(async () => {
			pendingQuery.resolve([]);
			await pendingQuery.promise;
		});
		expect(onReady).not.toHaveBeenCalled();
	});

	it("keeps the current note visible when prefetching fails", async () => {
		const error = new Error("query failed");
		const onReady = vi.fn();
		query.mockRejectedValueOnce(error);
		const { result } = renderHook(() =>
			useNoteNavigationPreparation({ workspaceId }),
		);

		result.current.prepareNoteNavigation(firstNoteId, onReady);
		await act(async () => {
			await Promise.resolve();
		});
		expect(onReady).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledWith(
			expect.objectContaining({
				error,
				noteId: firstNoteId,
			}),
		);
		expect(toastError).toHaveBeenCalledWith("Failed to open note");
	});
});
