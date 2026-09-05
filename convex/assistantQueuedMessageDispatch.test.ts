import { expect, test } from "vitest";
import { api } from "./_generated/api";
import {
	createChat,
	createWorkspace,
	queuedMessageInput,
	startRun,
} from "./assistantQueuedMessage.fixtures";

const fixture = async () => {
	const env = await createWorkspace();
	const scope = { workspaceId: env.workspaceId, chatId: "dispatch" };
	await createChat({ ...scope, asOwner: env.asOwner });
	const run = await startRun({ ...scope, asOwner: env.asOwner });
	const rows = [];
	for (const id of ["one", "two"])
		rows.push(
			await env.asOwner.mutation(
				api.assistantQueuedMessages.enqueueForActiveRun,
				{ ...scope, runId: run._id, message: queuedMessageInput(id, id) },
			),
		);
	return { ...env, scope, run, rows };
};

test("dispatch eligibility changes atomically with run completion, edit checkout and claims", async () => {
	const { asOwner, scope, run, rows } = await fixture();
	expect(
		await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope),
	).toBeNull();
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	expect(
		(await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope))
			?._id,
	).toBe(rows[0]._id);
	await asOwner.mutation(api.assistantQueuedMessageEditing.begin, {
		...scope,
		queuedMessageId: rows[0]._id,
	});
	expect(
		(await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope))
			?._id,
	).toBe(rows[1]._id);
	const claims = await Promise.all(
		[1, 2].map(() =>
			asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
				...scope,
				queuedMessageId: rows[1]._id,
				expectedStatus: "queued",
			}),
		),
	);
	expect(claims.map((claim) => claim.status).sort()).toEqual([
		"claimed",
		"unavailable",
	]);
	expect(
		await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope),
	).toBeNull();
});

test("stop and failure prevent background dispatch until explicitly resolved", async () => {
	const { asOwner, scope, run } = await fixture();
	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	expect(
		await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope),
	).toBeNull();
	await asOwner.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	expect(
		await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope),
	).toBeNull();
	await asOwner.mutation(
		api.assistantQueuedMessages.resumeInterruptedForChat,
		scope,
	);
	expect(
		await asOwner.query(api.assistantQueuedMessageDispatch.getHead, scope),
	).not.toBeNull();
});

test("chat discovery is paginated, scoped and excludes archived chats", async () => {
	const { asOwner, scope, t, run } = await fixture();
	const page = await asOwner.query(
		api.assistantQueuedMessageDispatch.listChats,
		{
			workspaceId: scope.workspaceId,
			paginationOpts: { numItems: 1, cursor: null },
		},
	);
	expect(page.page).toEqual([scope.chatId]);
	expect(page.isDone).toBe(false);
	const next = await asOwner.query(
		api.assistantQueuedMessageDispatch.listChats,
		{
			workspaceId: scope.workspaceId,
			paginationOpts: { numItems: 1, cursor: page.continueCursor },
		},
	);
	expect(next.page).toEqual([scope.chatId]);
	expect(next.isDone).toBe(true);
	await t.run((ctx) => ctx.db.patch(run.chatId, { isArchived: true }));
	expect(
		(
			await asOwner.query(api.assistantQueuedMessageDispatch.listChats, {
				workspaceId: scope.workspaceId,
				paginationOpts: { numItems: 50, cursor: null },
			})
		).page,
	).toEqual([]);
	const other = t.withIdentity({
		issuer: "test",
		subject: "other",
		tokenIdentifier: "other",
	});
	await expect(
		other.query(api.assistantQueuedMessageDispatch.listChats, {
			workspaceId: scope.workspaceId,
			paginationOpts: { numItems: 50, cursor: null },
		}),
	).rejects.toThrow("Workspace not found");
});
