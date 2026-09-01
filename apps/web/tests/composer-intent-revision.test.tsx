import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useRevisionedState } from "@/hooks/use-revisioned-state";

describe("composer intent revisions", () => {
	it("claims one draft revision and never restores it over newer text", () => {
		const { result } = renderHook(() => useComposerDraft<never>(null));
		act(() => result.current.setText("B"));
		const submittedDraft = result.current.getSnapshot();

		let claim: ReturnType<typeof result.current.claimSnapshot> = null;
		act(() => {
			claim = result.current.claimSnapshot(submittedDraft);
		});
		expect(claim).not.toBeNull();
		if (!claim) {
			throw new Error("Expected the draft claim to be accepted.");
		}
		expect(result.current.text).toBe("");
		expect(result.current.claimSnapshot(submittedDraft)).toBeNull();

		act(() => result.current.setText("D"));
		expect(result.current.isClaimCurrent(claim)).toBe(false);
		expect(result.current.restoreClaim(claim)).toBe(false);
		expect(result.current.text).toBe("D");
	});

	it("claims attachments synchronously and preserves a newer selection", () => {
		const { result } = renderHook(() => useRevisionedState(["b.txt"]));
		const submittedFiles = result.current.getSnapshot();

		let claim: ReturnType<typeof result.current.claimSnapshot> = null;
		act(() => {
			claim = result.current.claimSnapshot(submittedFiles, []);
		});
		if (!claim) {
			throw new Error("Expected the attachment claim to be accepted.");
		}
		expect(result.current.value).toEqual([]);

		act(() => result.current.setValue(["d.txt"]));
		expect(result.current.isClaimCurrent(claim)).toBe(false);
		expect(result.current.restoreClaim(claim)).toBe(false);
		expect(result.current.value).toEqual(["d.txt"]);
	});

	it("invalidates an old draft claim when the composer scope changes", () => {
		let scopeKey = "chat-1";
		const { result, rerender } = renderHook(() =>
			useComposerDraft<never>(scopeKey),
		);
		act(() => result.current.setText("B"));
		const submittedDraft = result.current.getSnapshot();
		let claim: ReturnType<typeof result.current.claimSnapshot> = null;
		act(() => {
			claim = result.current.claimSnapshot(submittedDraft);
		});
		if (!claim) {
			throw new Error("Expected the draft claim to be accepted.");
		}

		scopeKey = "chat-2";
		rerender();

		expect(result.current.isClaimCurrent(claim)).toBe(false);
	});
});
