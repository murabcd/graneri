import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenComponentEntry } from "@/lib/component-entry";

afterEach(cleanup);

describe("open component entry", () => {
	it("does not load its module while it is closed", () => {
		const loadModule = vi.fn(async () => ({
			Dialog: () => <div>Loaded dialog</div>,
		}));
		const Entry = createOpenComponentEntry(
			loadModule,
			(module) => module.Dialog,
		);

		render(<Entry open={false} />);

		expect(loadModule).not.toHaveBeenCalled();
	});

	it("loads its module when it opens without preloading", async () => {
		const loadModule = vi.fn(async () => ({
			Dialog: ({ open }: { open: boolean }) =>
				open ? <div>Loaded dialog</div> : null,
		}));
		const Entry = createOpenComponentEntry(
			loadModule,
			(module) => module.Dialog,
		);

		render(<Entry open />);

		expect(await screen.findByText("Loaded dialog")).not.toBeNull();
		expect(loadModule).toHaveBeenCalledTimes(1);
	});

	it("keeps the mounted component when its props change after loading", async () => {
		const Entry = createOpenComponentEntry(
			async () => ({
				Dialog: ({ page }: { open: boolean; page: string }) => (
					<div data-testid="loaded-dialog">{page}</div>
				),
			}),
			(module) => module.Dialog,
		);
		const { rerender } = render(<Entry open page="Profile" />);
		const dialog = await screen.findByTestId("loaded-dialog");

		rerender(<Entry open page="Voice" />);

		expect(screen.getByTestId("loaded-dialog")).toBe(dialog);
		expect(dialog.textContent).toBe("Voice");
	});

	it("renders a preloaded component synchronously when it opens", async () => {
		const loadModule = vi.fn(async () => ({
			Dialog: ({ open }: { open: boolean }) =>
				open ? <div>Loaded dialog</div> : null,
		}));
		const Entry = createOpenComponentEntry(
			loadModule,
			(module) => module.Dialog,
		);

		expect(Entry.preload).toBeTypeOf("function");
		await Entry.preload();
		render(<Entry open />);

		expect(screen.getByText("Loaded dialog")).not.toBeNull();
		expect(loadModule).toHaveBeenCalledTimes(1);
	});

	it("retries the module load when a speculative preload fails", async () => {
		const loadModule = vi
			.fn()
			.mockRejectedValueOnce(new Error("Chunk unavailable"))
			.mockResolvedValueOnce({
				Dialog: ({ open }: { open: boolean }) =>
					open ? <div>Loaded dialog</div> : null,
			});
		const Entry = createOpenComponentEntry(
			loadModule,
			(module) => module.Dialog,
		);

		await expect(Entry.preload()).rejects.toThrow("Chunk unavailable");
		render(<Entry open />);

		expect(await screen.findByText("Loaded dialog")).not.toBeNull();
		expect(loadModule).toHaveBeenCalledTimes(2);
	});
});
