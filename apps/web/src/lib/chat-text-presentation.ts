import {
	createBrowserFrameScheduler,
	type FrameScheduler,
} from "./browser-frame-scheduler";

const CHARACTERS_PER_FRAME = 24;
const COMPLETION_FRAMES = 8;

/** Keep one current string and a reveal cursor, never a queue of old snapshots. */
export const createChatTextPresentation = (
	initialText: string,
	initialStreaming: boolean,
	{
		scheduleFrame = createBrowserFrameScheduler(globalThis),
		isHidden = () => globalThis.document?.visibilityState === "hidden",
	}: { scheduleFrame?: FrameScheduler; isHidden?: () => boolean } = {},
) => {
	let target = initialText;
	let visible = initialText;
	let streaming = initialStreaming;
	let drainFrames: number | null = null;
	let cancelFrame: (() => void) | undefined;
	const listeners = new Set<() => void>();
	let snapshot = { text: visible, isPending: false };

	const publish = () => {
		const isPending = visible.length < target.length;
		if (snapshot.text === visible && snapshot.isPending === isPending) return;
		snapshot = { text: visible, isPending };
		for (const listener of listeners) listener();
	};
	const cancel = () => {
		cancelFrame?.();
		cancelFrame = undefined;
	};
	const schedule = () => {
		if (cancelFrame || visible === target || listeners.size === 0) return;
		cancelFrame = scheduleFrame(() => {
			cancelFrame = undefined;
			const remaining = target.length - visible.length;
			const count = isHidden()
				? remaining
				: Math.max(
						CHARACTERS_PER_FRAME,
						drainFrames === null ? 0 : Math.ceil(remaining / drainFrames),
					);
			let end = Math.min(target.length, visible.length + count);
			// Do not publish half of a UTF-16 surrogate pair.
			const last = target.charCodeAt(end - 1);
			if (end < target.length && last >= 0xd800 && last <= 0xdbff) end++;
			visible = target.slice(0, end);
			if (drainFrames !== null) drainFrames--;
			if (visible === target) drainFrames = null;
			publish();
			schedule();
		});
	};

	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			schedule();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) cancel();
			};
		},
		update(text: string, isStreaming: boolean) {
			const shouldReveal = streaming || isStreaming || visible !== target;
			const appended = text.startsWith(target);
			target = text;
			streaming = isStreaming;
			if (!shouldReveal || !appended || isHidden()) {
				cancel();
				visible = target;
				drainFrames = null;
			} else if (streaming) {
				drainFrames = null;
			} else if (visible.length < target.length) {
				drainFrames ??= COMPLETION_FRAMES;
			}
			publish();
			schedule();
		},
	};
};
