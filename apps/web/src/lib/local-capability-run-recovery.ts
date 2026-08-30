import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { ChatRequestBody } from "@/lib/chat-request-preparation";
import type { LocalToolCall } from "@/lib/desktop-local-tool-call";

export type PendingLocalCapabilityToolCall = Omit<LocalToolCall, "input"> & {
	inputJson: string;
};

export type RecoverableLocalCapabilityRun = {
	_id: string;
	localCapabilitySession: LocalCapabilitySession | null;
	pendingLocalCapabilityToolCalls?: PendingLocalCapabilityToolCall[];
};

export type LocalCapabilityToolOutputSubmission =
	| {
			output: unknown;
			options: { body: ChatRequestBody & { continueRunId: string } };
			tool: string;
			toolCallId: string;
	  }
	| {
			errorText: string;
			options: { body: ChatRequestBody & { continueRunId: string } };
			state: "output-error";
			tool: string;
			toolCallId: string;
	  };

const parsePersistedLocalToolInput = (inputJson: string): unknown =>
	JSON.parse(inputJson) as unknown;

const getRecoveryErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Local tool recovery failed.";

export const recoverPendingLocalCapabilityToolCalls = async ({
	buildRequestBody,
	claimedRecoveryKeys,
	executeToolCall,
	onExecutionError,
	run,
	setLatestRequestBody,
	submitToolOutput,
}: {
	buildRequestBody: (
		session: LocalCapabilitySession,
	) => Promise<ChatRequestBody>;
	claimedRecoveryKeys: Set<string>;
	executeToolCall: (args: {
		localCapabilitySession: LocalCapabilitySession;
		toolCall: LocalToolCall;
	}) => Promise<unknown>;
	onExecutionError: (error: unknown) => void;
	run: RecoverableLocalCapabilityRun | null;
	setLatestRequestBody: (requestBody: ChatRequestBody) => void;
	submitToolOutput: (
		submission: LocalCapabilityToolOutputSubmission,
	) => PromiseLike<unknown> | unknown;
}) => {
	const session = run?.localCapabilitySession;
	if (!run || !session) {
		return;
	}

	for (const pendingToolCall of run.pendingLocalCapabilityToolCalls ?? []) {
		const recoveryKey = `${run._id}:${pendingToolCall.toolCallId}`;
		if (claimedRecoveryKeys.has(recoveryKey)) {
			continue;
		}
		claimedRecoveryKeys.add(recoveryKey);

		try {
			const requestBody = await buildRequestBody(session);
			setLatestRequestBody(requestBody);
			const options = {
				body: { ...requestBody, continueRunId: run._id },
			};
			const toolCall = {
				input: parsePersistedLocalToolInput(pendingToolCall.inputJson),
				toolCallId: pendingToolCall.toolCallId,
				toolName: pendingToolCall.toolName,
			};

			let submission: LocalCapabilityToolOutputSubmission;
			try {
				const output = await executeToolCall({
					localCapabilitySession: session,
					toolCall,
				});
				submission = {
					options,
					output,
					tool: pendingToolCall.toolName,
					toolCallId: pendingToolCall.toolCallId,
				};
			} catch (error) {
				onExecutionError(error);
				submission = {
					errorText: getRecoveryErrorMessage(error),
					options,
					state: "output-error",
					tool: pendingToolCall.toolName,
					toolCallId: pendingToolCall.toolCallId,
				};
			}
			await submitToolOutput(submission);
		} catch (error) {
			claimedRecoveryKeys.delete(recoveryKey);
			throw error;
		}
	}
};
