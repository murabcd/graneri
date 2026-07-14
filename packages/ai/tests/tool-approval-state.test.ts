import { describe, expect, test } from "vitest";
import {
	createCanonicalToolApprovalResponse,
	getPendingToolApproval,
	getToolApprovalRequest,
	getToolApprovalResponse,
} from "../src/tool-approval-state.mjs";

const approvalPart = {
	type: "tool-delete_automation",
	toolCallId: "call-1",
	input: { automationId: "automation-1" },
	approval: { id: "approval-1" },
	state: "approval-requested",
} as const;

describe("tool approval state", () => {
	test("extracts a pending SDK tool approval", () => {
		const message = {
			id: "assistant-1",
			role: "assistant" as const,
			parts: [approvalPart],
		};

		expect(getToolApprovalRequest(message)).toEqual({
			approvalId: "approval-1",
			assistantMessageId: "assistant-1",
			input: { automationId: "automation-1" },
			toolCallId: "call-1",
			toolName: "delete_automation",
		});
		expect(getPendingToolApproval([message])).toEqual(
			getToolApprovalRequest(message),
		);
	});

	test("extracts a responded approval and ignores stale requests", () => {
		const responseMessage = {
			id: "assistant-1",
			role: "assistant" as const,
			parts: [
				{
					...approvalPart,
					approval: { id: "approval-1", approved: false },
					state: "approval-responded" as const,
				},
			],
		};

		expect(getToolApprovalResponse(responseMessage)?.approved).toBe(false);
		expect(
			getPendingToolApproval([
				{
					id: "assistant-old",
					role: "assistant",
					parts: [approvalPart],
				},
				{ id: "user-1", role: "user", parts: [{ type: "text", text: "next" }] },
			]),
		).toBeNull();
	});

	test("reconstructs the response from server-owned tool input", () => {
		const message = createCanonicalToolApprovalResponse({
			approvalResponse: {
				approvalId: "approval-1",
				approved: true,
				assistantMessageId: "assistant-1",
				input: { automationId: "tampered" },
				toolCallId: "call-1",
				toolName: "delete_automation",
			},
			storedMessage: {
				id: "assistant-1",
				role: "assistant",
				partsJson: JSON.stringify([approvalPart]),
			},
		});

		expect(message.parts).toEqual([
			expect.objectContaining({
				approval: expect.objectContaining({ approved: true }),
				input: { automationId: "automation-1" },
				state: "approval-responded",
			}),
		]);
	});

	test("canonicalizes every approval response in one tool step", () => {
		const secondRequest = {
			...approvalPart,
			approval: { id: "approval-2" },
			toolCallId: "call-2",
		};
		const approvalResponses = [
			{
				approvalId: "approval-1",
				approved: true,
				assistantMessageId: "assistant-1",
				input: approvalPart.input,
				toolCallId: "call-1",
				toolName: "delete_automation",
			},
			{
				approvalId: "approval-2",
				approved: false,
				assistantMessageId: "assistant-1",
				input: secondRequest.input,
				toolCallId: "call-2",
				toolName: "delete_automation",
			},
		];
		const message = createCanonicalToolApprovalResponse({
			approvalResponse: approvalResponses[1],
			approvalResponses,
			storedMessage: {
				id: "assistant-1",
				role: "assistant",
				partsJson: JSON.stringify([approvalPart, secondRequest]),
			},
		});

		expect(message.parts).toEqual([
			expect.objectContaining({
				approval: expect.objectContaining({ approved: true }),
				toolCallId: "call-1",
			}),
			expect.objectContaining({
				approval: expect.objectContaining({ approved: false }),
				toolCallId: "call-2",
			}),
		]);
	});
});
