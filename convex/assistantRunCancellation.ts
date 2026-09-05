/** Cancel external work when the durable run stops or rotates its generation. */
export const withAssistantRunCancellation = async <Result>(
	isActive: () => Promise<boolean>,
	execute: (signal: AbortSignal) => Promise<Result>,
	stoppedError: Error,
): Promise<Result> => {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	const check = async () => {
		try {
			if (!(await isActive())) {
				controller.abort(stoppedError);
			}
		} catch (error) {
			controller.abort(error);
		}
		if (!closed && !controller.signal.aborted) timer = setTimeout(check, 1_000);
	};
	await check();
	try {
		controller.signal.throwIfAborted();
		const result = await execute(controller.signal);
		controller.signal.throwIfAborted();
		return result;
	} catch (error) {
		controller.signal.throwIfAborted();
		throw error;
	} finally {
		closed = true;
		clearTimeout(timer);
	}
};
