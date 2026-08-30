import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalCapabilitySession } from "@/hooks/use-local-capability-session";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
	vi.restoreAllMocks();
});

describe("local capability session hook", () => {
	it("ignores a stale load after the chat scope changes", async () => {
		const resolvers = new Map<
			string,
			(value: { session: { id: string; label: string } | null }) => void
		>();
		const getLocalCapabilitySession = vi.fn(
			(scope: string) =>
				new Promise<{ session: { id: string; label: string } | null }>(
					(resolve) => {
						resolvers.set(scope, resolve);
					},
				),
		);
		window.graneriDesktop = {
			getLocalCapabilitySession,
			platform: "darwin",
		} as Window["graneriDesktop"];

		const { result, rerender } = renderHook(
			({ scope }) => useLocalCapabilitySession(scope),
			{ initialProps: { scope: "chat:a" } },
		);
		await waitFor(() =>
			expect(getLocalCapabilitySession).toHaveBeenCalledTimes(1),
		);

		rerender({ scope: "chat:b" });
		await waitFor(() =>
			expect(getLocalCapabilitySession).toHaveBeenCalledTimes(2),
		);
		await act(async () => {
			resolvers.get("chat:b")?.({
				session: { id: "capability-b", label: "b" },
			});
		});
		expect(result.current.localCapabilitySession).toEqual({
			id: "capability-b",
			label: "b",
		});

		await act(async () => {
			resolvers.get("chat:a")?.({
				session: { id: "capability-a", label: "a" },
			});
		});
		expect(result.current.localCapabilitySession).toEqual({
			id: "capability-b",
			label: "b",
		});
	});

	it("chooses, replaces, and revokes a desktop-owned session", async () => {
		const pickLocalFolder = vi
			.fn()
			.mockResolvedValueOnce({
				canceled: false,
				session: { id: "capability-graneri", label: "graneri" },
			})
			.mockResolvedValueOnce({
				canceled: false,
				session: { id: "capability-fluently", label: "fluently" },
			});
		const revokeLocalCapabilitySession = vi
			.fn()
			.mockResolvedValue({ ok: true });
		window.graneriDesktop = {
			getLocalCapabilitySession: vi.fn().mockResolvedValue({ session: null }),
			pickLocalFolder,
			platform: "darwin",
			revokeLocalCapabilitySession,
		} as Window["graneriDesktop"];

		const { result } = renderHook(() =>
			useLocalCapabilitySession("chat:graneri"),
		);
		await waitFor(() =>
			expect(result.current.localCapabilitySession).toBeNull(),
		);

		await act(async () => result.current.chooseLocalCapabilityFolder());
		expect(pickLocalFolder).toHaveBeenCalledWith("chat:graneri");
		expect(result.current.localCapabilitySession).toEqual({
			id: "capability-graneri",
			label: "graneri",
		});

		await act(async () => result.current.chooseLocalCapabilityFolder());
		expect(result.current.localCapabilitySession).toEqual({
			id: "capability-fluently",
			label: "fluently",
		});

		await act(async () => result.current.revokeLocalCapability());
		expect(revokeLocalCapabilitySession).toHaveBeenCalledWith("chat:graneri");
		expect(result.current.localCapabilitySession).toBeNull();
	});
});
