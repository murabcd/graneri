import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createWorkspace = async () => {
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

	return {
		asOwner,
		t,
		workspaceId,
	};
};

type WorkspaceFixture = Awaited<ReturnType<typeof createWorkspace>>;
type AsOwner = WorkspaceFixture["asOwner"];
type WorkspaceId = WorkspaceFixture["workspaceId"];

test("large tool results survive terminal cleanup in independently loaded events and release when history is deleted", async () => {
	vi.useFakeTimers();
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "large-tool";
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId,
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		message: {
			id: "user",
			role: "user",
			text: "Search",
			partsJson: '[{"type":"text","text":"Search"}]',
			createdAt: 1000,
		},
	});
	const run = await startRunAndStream({ asOwner, chatId, workspaceId });
	const identity = {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		toolCallId: "large-result",
	};
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		...identity,
		toolName: "search",
		inputJson: '{"query":"large"}',
	});
	const outputJson = JSON.stringify({ result: "🌲".repeat(300_000) });
	const finished = await asOwner.mutation(
		api.chatToolCalls.finishActiveStreamToolCall,
		{ ...identity, status: "completed", outputJson },
	);
	expect(finished.outputJson === outputJson).toBe(true);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	const events = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{ runId: run._id },
	);
	expect(JSON.stringify(events).length).toBeLessThan(5000);
	const completed = events.find(
		(event) => event.event.type === "tool.completed",
	);
	if (!completed) throw new Error("Expected completed tool event.");
	const body = await asOwner.query(
		api.assistantRunEvents.readEventToolContent,
		{ runId: run._id, eventIndex: completed.eventIndex },
	);
	expect(body?.outputJson === outputJson).toBe(true);
	expect(await t.run((ctx) => ctx.db.query("chatToolCalls").collect())).toEqual(
		[],
	);
	await asOwner.mutation(api.chats.remove, { workspaceId, chatId });
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(await t.run((ctx) => ctx.db.query("chatContents").collect())).toEqual(
		[],
	);
	expect(
		await t.run((ctx) => ctx.db.query("chatPayloadChunks").collect()),
	).toEqual([]);
	vi.useRealTimers();
});

const startRunAndStream = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
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
	return run;
};

test("active stream tool calls persist lifecycle for the current stream", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-tools",
		preview: "Search for a note",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search for a note" }]),
			text: "Search for a note",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId: "chat-tools",
	});

	const startedToolCall = await asOwner.mutation(
		api.chatToolCalls.startActiveStreamToolCall,
		{
			workspaceId,
			chatId: "chat-tools",
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			toolCallId: "tool-call-1",
			toolName: "search",
			inputJson: JSON.stringify({ query: "note" }),
		},
	);

	expect(startedToolCall.status).toBe("pending");
	expect(startedToolCall.toolName).toBe("search");
	expect(startedToolCall.inputJson).toBe(JSON.stringify({ query: "note" }));

	const completedToolCall = await asOwner.mutation(
		api.chatToolCalls.finishActiveStreamToolCall,
		{
			workspaceId,
			chatId: "chat-tools",
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			toolCallId: "tool-call-1",
			status: "completed",
			outputJson: JSON.stringify({ result: "found" }),
		},
	);

	expect(completedToolCall.status).toBe("completed");
	expect(completedToolCall.outputJson).toBe(
		JSON.stringify({ result: "found" }),
	);

	const storedToolCalls = await t.run(async (ctx) =>
		ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
	);
	expect(storedToolCalls).toHaveLength(1);
	expect(storedToolCalls[0]?.runId).toBe(run._id);

	const liveEvents = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{ runId: run._id },
	);
	expect(liveEvents.map((eventRecord) => eventRecord.event)).toEqual([
		{
			type: "run.started",
			assistantMessageId: run.assistantMessageId,
			model: "gpt-5",
			serviceTier: "auto",
		},
		{
			type: "assistant.message.started",
			assistantMessageId: run.assistantMessageId,
		},
		{
			type: "tool.started",
			toolCallId: "tool-call-1",
			toolName: "search",
			contentId: expect.any(String),
		},
		{
			type: "tool.completed",
			toolCallId: "tool-call-1",
			status: "completed",
			contentId: expect.any(String),
		},
	]);

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const terminalRows = await t.run(async (ctx) => ({
		toolCalls: await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(10),
		events: await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect(),
	}));
	expect(terminalRows.toolCalls).toHaveLength(0);
	expect(terminalRows.events.map((eventRecord) => eventRecord.event)).toEqual([
		{
			type: "run.started",
			assistantMessageId: run.assistantMessageId,
			model: "gpt-5",
			serviceTier: "auto",
		},
		{
			type: "assistant.message.started",
			assistantMessageId: run.assistantMessageId,
		},
		{
			type: "tool.started",
			toolCallId: "tool-call-1",
			toolName: "search",
			contentId: expect.any(String),
		},
		{
			type: "tool.completed",
			toolCallId: "tool-call-1",
			status: "completed",
			contentId: expect.any(String),
		},
		{ type: "run.completed" },
	]);
	const toolEvents = terminalRows.events.filter(
		(record) =>
			record.event.type === "tool.started" ||
			record.event.type === "tool.completed",
	);
	if (!toolEvents[0] || !toolEvents[1])
		throw new Error("Expected both tool events.");
	expect(
		await asOwner.query(api.assistantRunEvents.readEventToolContent, {
			runId: run._id,
			eventIndex: toolEvents[0].eventIndex,
		}),
	).toEqual({ inputJson: JSON.stringify({ query: "note" }) });
	expect(
		await asOwner.query(api.assistantRunEvents.readEventToolContent, {
			runId: run._id,
			eventIndex: toolEvents[1].eventIndex,
		}),
	).toEqual({
		inputJson: JSON.stringify({ query: "note" }),
		outputJson: JSON.stringify({ result: "found" }),
	});
});

test("active stream tool calls reject stale run ids", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-tools-stale",
		preview: "Search for a note",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search for a note" }]),
			text: "Search for a note",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId: "chat-tools-stale",
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
			workspaceId,
			chatId: "chat-tools-stale",
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			toolCallId: "tool-call-1",
			toolName: "search",
		}),
	).rejects.toThrow("Active chat stream not found.");
});
