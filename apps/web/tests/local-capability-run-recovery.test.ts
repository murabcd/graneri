import { describe, expect, it, vi } from "vitest";
import { recoverPendingLocalCapabilityToolCalls } from "@/lib/local-capability-run-recovery";

const requestBody = {
	chatMode: "default" as const,
	convexToken: "token",
	localCapabilitySession: { id: "capability-1", label: "graneri" },
	mentions: [],
	model: "gpt-5.6-sol",
	projectId: null,
	reasoningEffort: "medium" as const,
	recipeSlug: null,
	selectedSourceIds: [],
	serviceTier: "auto" as const,
	timezone: "UTC",
	webSearchEnabled: false,
	workspaceId: "workspace-1",
};

const run = {
	_id: "run-1",
	localCapabilitySession: requestBody.localCapabilitySession,
	pendingLocalCapabilityToolCalls: [
		{
			inputJson: JSON.stringify({ relativePath: ".", rootIndex: 0 }),
			toolCallId: "tool-call-1",
			toolName: "list_local_directory",
		},
	],
};

describe("local capability run recovery", () => {
	it("executes a pending call with its run-bound session and continues that run", async () => {
		const claimedRecoveryKeys = new Set<string>();
		const executeToolCall = vi.fn().mockResolvedValue({ entries: [] });
		const submitToolOutput = vi.fn().mockResolvedValue(undefined);
		const setLatestRequestBody = vi.fn();

		await recoverPendingLocalCapabilityToolCalls({
			buildRequestBody: async () => requestBody,
			claimedRecoveryKeys,
			executeToolCall,
			onExecutionError: vi.fn(),
			run,
			setLatestRequestBody,
			submitToolOutput,
		});

		expect(executeToolCall).toHaveBeenCalledWith({
			localCapabilitySession: requestBody.localCapabilitySession,
			toolCall: {
				input: { relativePath: ".", rootIndex: 0 },
				toolCallId: "tool-call-1",
				toolName: "list_local_directory",
			},
		});
		expect(setLatestRequestBody).toHaveBeenCalledWith(requestBody);
		expect(submitToolOutput).toHaveBeenCalledWith({
			options: { body: { ...requestBody, continueRunId: "run-1" } },
			output: { entries: [] },
			tool: "list_local_directory",
			toolCallId: "tool-call-1",
		});
	});

	it("deduplicates completed recovery and releases a failed continuation for retry", async () => {
		const claimedRecoveryKeys = new Set<string>();
		const executeToolCall = vi.fn().mockResolvedValue({ entries: [] });
		const submitToolOutput = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const args = {
			buildRequestBody: async () => requestBody,
			claimedRecoveryKeys,
			executeToolCall,
			onExecutionError: vi.fn(),
			run,
			setLatestRequestBody: vi.fn(),
			submitToolOutput,
		};

		await expect(recoverPendingLocalCapabilityToolCalls(args)).rejects.toThrow(
			"offline",
		);
		expect(claimedRecoveryKeys).toEqual(new Set());

		await recoverPendingLocalCapabilityToolCalls(args);
		await recoverPendingLocalCapabilityToolCalls(args);
		expect(executeToolCall).toHaveBeenCalledTimes(2);
		expect(submitToolOutput).toHaveBeenCalledTimes(2);
	});

	it("continues with an explicit error when local execution fails", async () => {
		const executionError = new Error("capability revoked");
		const onExecutionError = vi.fn();
		const submitToolOutput = vi.fn().mockResolvedValue(undefined);

		await recoverPendingLocalCapabilityToolCalls({
			buildRequestBody: async () => requestBody,
			claimedRecoveryKeys: new Set(),
			executeToolCall: vi.fn().mockRejectedValue(executionError),
			onExecutionError,
			run,
			setLatestRequestBody: vi.fn(),
			submitToolOutput,
		});

		expect(onExecutionError).toHaveBeenCalledWith(executionError);
		expect(submitToolOutput).toHaveBeenCalledWith(
			expect.objectContaining({
				errorText: "capability revoked",
				state: "output-error",
			}),
		);
	});
});
