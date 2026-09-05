import { describe, expect, it } from "vitest";
import { createChatTextPresentation } from "../src/lib/chat-text-presentation";

const createHarness = (initial = "", streaming = true) => {
	const callbacks = new Set<() => void>();
	let hidden = false;
	const presentation = createChatTextPresentation(initial, streaming, {
		scheduleFrame: (callback) => {
			callbacks.add(callback);
			return () => callbacks.delete(callback);
		},
		isHidden: () => hidden,
	});
	const unsubscribe = presentation.subscribe(() => undefined);
	return {
		presentation,
		unsubscribe,
		hide: () => {
			hidden = true;
		},
		frame: () => {
			const current = [...callbacks];
			callbacks.clear();
			for (const callback of current) callback();
		},
		pending: () => callbacks.size,
	};
};

describe("chat text presentation", () => {
	it("batches both tiny SSE deltas and whole Convex snapshots into character frames", () => {
		const deltas = createHarness();
		const snapshots = createHarness();
		const full = "abcdefghij".repeat(20);
		for (let index = 1; index <= full.length; index++) {
			deltas.presentation.update(full.slice(0, index), true);
		}
		snapshots.presentation.update(full, true);
		expect(deltas.pending()).toBe(1);
		expect(snapshots.pending()).toBe(1);
		for (let frame = 1; frame <= 9; frame++) {
			deltas.frame();
			snapshots.frame();
			expect(deltas.presentation.getSnapshot()).toEqual(
				snapshots.presentation.getSnapshot(),
			);
			expect(deltas.presentation.getSnapshot().text).toBe(
				full.slice(0, frame * 24),
			);
		}
		expect(deltas.pending()).toBe(0);
	});

	it("drains a large completed response in at most eight frames without dropping its tail", () => {
		const h = createHarness();
		const full = `${"x".repeat(100_000)}FINAL`;
		h.presentation.update(full, true);
		h.frame();
		expect(h.presentation.getSnapshot().text.length).toBe(24);
		h.presentation.update(full, false);
		let previous = h.presentation.getSnapshot().text;
		for (let frame = 0; frame < 8; frame++) {
			h.frame();
			const current = h.presentation.getSnapshot().text;
			expect(current.startsWith(previous)).toBe(true);
			previous = current;
		}
		expect(h.presentation.getSnapshot()).toEqual({
			text: full,
			isPending: false,
		});
		expect(h.pending()).toBe(0);
	});

	it("catches up while hidden and cancels callbacks when the view unmounts", () => {
		const h = createHarness();
		h.presentation.update("a".repeat(2000), true);
		h.hide();
		h.frame();
		expect(h.presentation.getSnapshot().text).toHaveLength(2000);
		h.presentation.update("a".repeat(3000), false);
		expect(h.presentation.getSnapshot().text).toHaveLength(3000);
		expect(h.pending()).toBe(0);
		const active = createHarness();
		active.presentation.update("b".repeat(100), true);
		active.unsubscribe();
		expect(active.pending()).toBe(0);
		const unsubscribe = active.presentation.subscribe(() => undefined);
		expect(active.pending()).toBe(1);
		unsubscribe();
	});

	it("preserves Unicode and resets replaced content instead of replaying stale text", () => {
		const h = createHarness();
		const text = `${"a".repeat(23)}🌳${"b".repeat(50)}`;
		h.presentation.update(text, true);
		h.frame();
		expect(h.presentation.getSnapshot().text).toBe(`${"a".repeat(23)}🌳`);
		h.presentation.update("replacement", false);
		expect(h.presentation.getSnapshot()).toEqual({
			text: "replacement",
			isPending: false,
		});
		expect(h.pending()).toBe(0);
	});

	it("shows loaded history immediately and does not create frame work for static edits", () => {
		const h = createHarness("saved history", false);
		expect(h.presentation.getSnapshot().text).toBe("saved history");
		h.presentation.update("saved history corrected", false);
		expect(h.presentation.getSnapshot().text).toBe("saved history corrected");
		expect(h.pending()).toBe(0);
	});
});
