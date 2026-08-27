import { describe, expect, it } from "vitest";
import {
	getHostedHumanDecisionPendingDecision,
	getMatchingPendingHostedHumanDecision,
	getPendingHostedHumanDecision,
} from "../src/hosted-human-decision.mjs";

const approvalMessage = {
	id: "assistant-approval",
	role: "assistant" as const,
	parts: [
		{
			type: "tool-delete_automation" as const,
			toolCallId: "call-1",
			input: { automationId: "automation-1" },
			approval: { id: "approval-1" },
			state: "approval-requested" as const,
		},
	],
};

describe("hosted human decisions", () => {
	it("creates one durable approval decision without duplicating tool input", () => {
		expect(
			getHostedHumanDecisionPendingDecision(approvalMessage),
		).toMatchObject({
			type: "tool_approval",
			approvalId: "approval-1",
			consequence: "This action can change data or perform an external action.",
		});
		expect(
			getHostedHumanDecisionPendingDecision(approvalMessage),
		).not.toHaveProperty("input");
	});

	it("stops exposing a pending decision after the next user message", () => {
		expect(
			getPendingHostedHumanDecision([
				approvalMessage,
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "next" }],
				},
			]),
		).toBeNull();
	});

	it("exposes a decision only while durable run state is waiting for it", () => {
		const pendingDecision =
			getHostedHumanDecisionPendingDecision(approvalMessage);
		expect(
			getMatchingPendingHostedHumanDecision({
				messages: [approvalMessage],
				pendingDecision,
			}),
		).toMatchObject({ approvalId: "approval-1", type: "tool_approval" });
		expect(
			getMatchingPendingHostedHumanDecision({
				messages: [approvalMessage],
				pendingDecision: null,
			}),
		).toBeNull();
		expect(
			getMatchingPendingHostedHumanDecision({
				messages: [approvalMessage],
				pendingDecision: pendingDecision
					? { ...pendingDecision, toolCallId: "different-call" }
					: null,
			}),
		).toBeNull();
	});
});
