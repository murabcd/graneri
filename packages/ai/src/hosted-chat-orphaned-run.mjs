export const stopOrphanedHostedAssistantRun = async ({
	chatId,
	assistantMessageId,
	finishStoppedAssistantRun,
	logLatency,
	requestStopAssistantRun,
	runId,
	stopActiveStream,
	workspaceId,
}) => {
	logLatency("stream.reconnect_orphaned_run_stop_start", {
		runId,
	});
	await requestStopAssistantRun({
		runId,
		assistantMessageId,
		stopReason: "cleanup_failed",
	});
	await stopActiveStream({
		workspaceId,
		chatId,
		runId,
		assistantMessageId,
	});
	await finishStoppedAssistantRun({ runId, assistantMessageId });
	logLatency("stream.reconnect_orphaned_run_stop_done", {
		runId,
	});
};
