import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
	createChat,
	createWorkspace,
	queuedMessageInput,
	startRun,
} from "./assistantQueuedMessage.fixtures";

afterEach(() => vi.useRealTimers());
const fixture = async () => {
	const env = await createWorkspace();
	const scope = { workspaceId: env.workspaceId, chatId: "neighbors" };
	await createChat({ ...scope, asOwner: env.asOwner });
	const run = await startRun({ ...scope, asOwner: env.asOwner });
	const enqueue = (text: string) =>
		env.asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			...scope,
			runId: run._id,
			message: queuedMessageInput(text, text),
		});
	const rows: Array<Awaited<ReturnType<typeof enqueue>>> = [];
	for (const name of ["a", "b", "c", "d"]) rows.push(await enqueue(name));
	const draft = await env.asOwner.mutation(
		api.assistantQueuedMessageEditing.begin,
		{ ...scope, queuedMessageId: rows[1]._id },
	);
	const reorder = (indexes: number[]) =>
		env.asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			...scope,
			queuedMessageIds: indexes.map((index) => rows[index]._id),
		});
	const discard = (index: number) =>
		env.asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			...scope,
			queuedMessageId: rows[index]._id,
		});
	const restore = async (action: "save" | "cancel") => {
		const args = {
			...scope,
			queuedMessageId: draft._id,
			claimVersion: draft.claimVersion,
		};
		if (action === "save")
			await env.asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
				...args,
				message: queuedMessageInput("b", "b"),
			});
		else
			await env.asOwner.mutation(
				api.assistantQueuedMessageEditing.cancel,
				args,
			);
	};
	const order = async () =>
		(
			await env.asOwner.query(
				api.assistantQueuedMessages.listQueuedForChat,
				scope,
			)
		).map((row) => row.messageId);
	return {
		...env,
		scope,
		run,
		rows,
		draft,
		enqueue,
		reorder,
		discard,
		restore,
		order,
	};
};

test.each([
	"save",
	"cancel",
] as const)("%s follows the surviving next neighbor when both neighbors move", async (action) => {
	const f = await fixture();
	await f.reorder([3, 2, 0]);
	// Read the durable draft as a remounted client would; no local position is needed.
	expect(
		await f.asOwner.query(api.assistantQueuedMessageEditing.get, f.scope),
	).toEqual(f.draft);
	await f.restore(action);
	expect(await f.order()).toEqual(["d", "b", "c", "a"]);
	const restored = await f.t.run((ctx) => ctx.db.get(f.draft._id));
	expect(restored).not.toHaveProperty("editPosition");
	expect(restored).not.toHaveProperty("editOrigin");
});

test.each([
	"save",
	"cancel",
] as const)("%s follows the previous neighbor when the next is deleted", async (action) => {
	const f = await fixture();
	await f.discard(2);
	await f.reorder([3, 0]);
	await f.restore(action);
	expect(await f.order()).toEqual(["d", "a", "b"]);
});

test.each([
	"save",
	"cancel",
] as const)("%s has an explicit position when both neighbors are gone", async (action) => {
	const f = await fixture();
	await f.discard(0);
	await f.discard(2);
	await f.enqueue("e");
	await f.restore(action);
	expect(await f.order()).toEqual(
		action === "save" ? ["d", "e", "b"] : ["d", "b", "e"],
	);
});

test("switching drafts restores the previous one before capturing the next position", async () => {
	const f = await fixture();
	await f.reorder([3, 2, 0]);
	const next = await f.asOwner.mutation(
		api.assistantQueuedMessageEditing.begin,
		{ ...f.scope, queuedMessageId: f.rows[2]._id },
	);
	expect(await f.order()).toEqual(["d", "b", "a"]);
	expect(await f.t.run((ctx) => ctx.db.get(next._id))).toMatchObject({
		editPosition: {
			index: 2,
			previousMessageId: f.draft._id,
			nextMessageId: f.rows[0]._id,
		},
	});
	await f.asOwner.mutation(api.assistantQueuedMessageEditing.cancel, {
		...f.scope,
		queuedMessageId: next._id,
		claimVersion: next.claimVersion,
	});
	expect(await f.order()).toEqual(["d", "b", "c", "a"]);
});

test("restoration and later admission keep strict FIFO even within one clock tick", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(100_000);
	const f = await fixture();
	await f.reorder([3, 2, 0]);
	await f.restore("save");
	await f.enqueue("e");
	expect(await f.order()).toEqual(["d", "b", "c", "a", "e"]);
	const rows = await f.asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		f.scope,
	);
	expect(new Set(rows.map((row) => row.createdAt)).size).toBe(rows.length);
	await f.asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: f.run._id,
		assistantMessageId: f.run.assistantMessageId,
	});
	expect(
		(await f.asOwner.query(api.assistantQueuedMessageDispatch.getHead, f.scope))
			?._id,
	).toBe(f.rows[3]._id);
});

test("cancel restores into an emptied queue without reviving removed neighbors", async () => {
	const f = await fixture();
	for (const index of [0, 2, 3]) await f.discard(index);
	await f.restore("cancel");
	expect(await f.order()).toEqual(["b"]);
});
