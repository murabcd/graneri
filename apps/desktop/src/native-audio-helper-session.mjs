export const stopNativeAudioHelperSession = async ({
	clearSessionTimeouts,
	notReadyMessage,
	session,
}) => {
	session.isStopping = true;
	if (!session.hasStarted) {
		session.rejectStart?.(new Error(notReadyMessage));
	}
	clearTimeout(session.cleanupTimeout);
	session.cleanupTimeout = null;
	clearSessionTimeouts?.(session);

	await new Promise((resolvePromise) => {
		const finish = () => resolvePromise();
		session.process.once("exit", finish);
		session.process.once("error", finish);
		session.process.kill("SIGTERM");
		setTimeout(() => {
			if (!session.process.killed) {
				session.process.kill("SIGKILL");
			}
			resolvePromise();
		}, 1_000);
	});

	session.lineReader.close();
};
