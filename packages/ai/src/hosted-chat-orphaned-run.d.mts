type HostedChatLogDetails = Record<
	string,
	string | number | boolean | null | undefined
>;

export declare const stopOrphanedHostedAssistantRun: <
	TRunId extends string,
	TWorkspaceId extends string,
>({
	chatId,
	assistantMessageId,
	finishStoppedAssistantRun,
	logLatency,
	requestStopAssistantRun,
	runId,
	stopActiveStream,
	workspaceId,
}: {
	chatId: string;
	assistantMessageId: string;
	finishStoppedAssistantRun: (args: {
		runId: TRunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	logLatency: (event: string, details?: HostedChatLogDetails) => void;
	requestStopAssistantRun: (args: {
		runId: TRunId;
		assistantMessageId: string;
		stopReason: "cleanup_failed";
	}) => Promise<unknown>;
	runId: TRunId;
	stopActiveStream: (args: {
		workspaceId: TWorkspaceId;
		chatId: string;
		runId: TRunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	workspaceId: TWorkspaceId;
}) => Promise<void>;
