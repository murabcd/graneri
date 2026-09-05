export type FrameScheduler = (callback: () => void) => () => void;

export const createBrowserFrameScheduler =
	({
		document: visibility,
		requestAnimationFrame,
		cancelAnimationFrame,
	}: {
		document:
			| Pick<
					Document,
					"visibilityState" | "addEventListener" | "removeEventListener"
			  >
			| undefined;
		requestAnimationFrame: typeof globalThis.requestAnimationFrame;
		cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
	}): FrameScheduler =>
	(callback) => {
		let frameId: number | undefined;
		let timerId: ReturnType<typeof setTimeout> | undefined;
		const cancelPending = () => {
			if (frameId !== undefined) cancelAnimationFrame(frameId);
			clearTimeout(timerId);
			frameId = undefined;
			timerId = undefined;
		};
		const cancel = () => {
			cancelPending();
			visibility?.removeEventListener("visibilitychange", schedule);
		};
		const deliver = () => {
			cancel();
			callback();
		};
		function schedule() {
			cancelPending();
			if (visibility?.visibilityState !== "hidden" && requestAnimationFrame) {
				frameId = requestAnimationFrame(deliver);
			} else {
				timerId = setTimeout(deliver, 16);
			}
		}
		visibility?.addEventListener("visibilitychange", schedule);
		schedule();

		return cancel;
	};
