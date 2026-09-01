import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

test("accepting a matching tool approval resumes the same run atomically", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const chatId = "chat-tool-approval";
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Delete it" }]),
			text: "Delete it",
			createdAt: 2_000,
		},
	});
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: "stream-1",
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	const approvalRequest = {
		type: "tool-delete_automation",
		toolCallId: "call-1",
		input: { automationId: "automation-1" },
		approval: { id: "approval-1" },
		state: "approval-requested",
	};
	await asOwner.mutation(api.chats.saveAssistantMessageForRun, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		message: {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: JSON.stringify([approvalRequest]),
			text: "",
			createdAt: 2_001,
		},
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		pendingDecision: {
			type: "tool_approval",
			approvalId: "approval-1",
			assistantMessageId: run.assistantMessageId,
			toolCallId: "call-1",
			toolName: "delete_automation",
			consequence: "This action can change data or perform an external action.",
		},
	});

	await asOwner.mutation(api.toolApprovals.acceptResponse, {
		workspaceId,
		chatId,
		runId: run._id,
		nextAssistantMessageId: "stream-2",
		message: {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: JSON.stringify([
				{
					...approvalRequest,
					input: { automationId: "tampered-automation" },
					approval: { id: "approval-1", approved: true },
					state: "approval-responded",
				},
			]),
			text: "",
			createdAt: 2_002,
		},
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: "stream-2",
	});

	const state = await t.run(async (ctx) => {
		const savedRun = await ctx.db.get(run._id);
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();
		const message = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_messageId", (q) =>
						q.eq("chatId", chat._id).eq("messageId", run.assistantMessageId),
					)
					.unique()
			: null;
		const stream = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique();
		const events = await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect();
		return { events, message, savedRun, stream };
	});

	expect(state.savedRun).toMatchObject({
		assistantMessageId: "stream-2",
		status: "running",
	});
	expect(state.savedRun?.pendingDecision).toBeUndefined();
	expect(state.stream).toMatchObject({ assistantMessageId: "stream-2" });
	expect(state.events.at(-1)?.event).toEqual({
		type: "assistant.message.started",
		assistantMessageId: "stream-2",
	});
	expect(state.events.at(-2)?.event).toEqual({
		type: "input.resolved",
		resolution: {
			type: "tool_approval",
			approved: true,
			toolCallId: "call-1",
		},
	});
	expect(JSON.parse(state.message?.partsJson ?? "[]")).toEqual([
		expect.objectContaining({
			state: "approval-responded",
			approval: expect.objectContaining({
				id: "approval-1",
				approved: true,
			}),
			input: { automationId: "automation-1" },
		}),
	]);
});
