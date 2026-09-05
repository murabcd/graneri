import { expect, test } from "vitest";
import { api } from "./_generated/api";
import {
	createChat,
	createWorkspace,
	insertDuplicateActiveRun,
	queuedMessageInput,
	startRun,
} from "./assistantQueuedMessage.fixtures";

test("queued follow-ups can be edited without changing queue position", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-queued",
		workspaceId,
	});

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	await asOwner.mutation(api.assistantQueuedMessageEditing.begin, {
		workspaceId,
		chatId: "chat-edit-queued",
		queuedMessageId: firstMessage._id,
	});
	const updatedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.updateQueued,
		{
			claimVersion: 1,
			workspaceId,
			chatId: "chat-edit-queued",
			queuedMessageId: firstMessage._id,
			message: queuedMessageInput("queued-1", "Edited first"),
		},
	);
	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-edit-queued",
		},
	);

	expect(updatedMessage._id).toBe(firstMessage._id);
	expect(updatedMessage.createdAt).toBe(firstMessage.createdAt);
	expect(updatedMessage.text).toBe("Edited first");
	expect(queuedMessages.map((message) => message._id)).toEqual([
		firstMessage._id,
		secondMessage._id,
	]);
	expect(queuedMessages.map((message) => message.text)).toEqual([
		"Edited first",
		"Second",
	]);
});

test("queued follow-ups cannot be edited to empty text", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-empty-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-empty-queued",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-empty-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);

	await asOwner.mutation(api.assistantQueuedMessageEditing.begin, {
		workspaceId,
		chatId: "chat-edit-empty-queued",
		queuedMessageId: queuedMessage._id,
	});
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			claimVersion: 1,
			workspaceId,
			chatId: "chat-edit-empty-queued",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "   "),
		}),
	).rejects.toThrow("Queued message cannot be empty.");
});

test("queued follow-ups cannot be edited from another chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-edit-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			claimVersion: 1,
			workspaceId,
			chatId: "chat-edit-other",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Cross-chat edit"),
		}),
	).rejects.toThrow("Queued message cannot be edited.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

test("updateQueued fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-edit", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-edit",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-edit",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessageEditing.begin, {
		workspaceId,
		chatId: "chat-duplicate-edit",
		queuedMessageId: queuedMessage._id,
	});
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			claimVersion: 1,
			workspaceId,
			chatId: "chat-duplicate-edit",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Blocked edit"),
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

const editingFixture = async () => {
	const fixture = await createWorkspace();
	const { asOwner, workspaceId } = fixture;
	const chatId = "editing-safety";
	await createChat({ asOwner, workspaceId, chatId });
	const run = await startRun({ asOwner, workspaceId, chatId });
	const rows = [];
	for (const id of ["first", "second"])
		rows.push(
			await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
				workspaceId,
				chatId,
				runId: run._id,
				message: queuedMessageInput(id, id),
			}),
		);
	const scope = { workspaceId, chatId };
	const draft = await asOwner.mutation(
		api.assistantQueuedMessageEditing.begin,
		{ ...scope, queuedMessageId: rows[0]._id },
	);
	return { ...fixture, scope, run, rows, draft };
};

test("editing is excluded from steer and replay while the remaining queue advances", async () => {
	const { asOwner, scope, run, rows, draft } = await editingFixture();
	expect(
		await asOwner.query(api.assistantQueuedMessages.listQueuedForChat, scope),
	).toEqual([rows[1]]);
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: draft._id,
		}),
	).rejects.toThrow();
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	expect(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			...scope,
			expectedStatus: "queued",
			queuedMessageId: draft._id,
		}),
	).toEqual({ status: "unavailable" });
	expect(
		(
			await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
				...scope,
				expectedStatus: "queued",
				queuedMessageId: rows[1]._id,
			})
		).status,
	).toBe("claimed");
	expect(
		await asOwner.query(api.assistantQueuedMessageEditing.get, scope),
	).toEqual(draft);
});

test("switching edits is atomic and stale save and cancel cannot finish a newer generation", async () => {
	const { asOwner, scope, rows, draft } = await editingFixture();
	await asOwner.mutation(api.assistantQueuedMessageEditing.begin, {
		...scope,
		queuedMessageId: rows[1]._id,
	});
	const latest = await asOwner.mutation(
		api.assistantQueuedMessageEditing.begin,
		{ ...scope, queuedMessageId: draft._id },
	);
	expect(latest.claimVersion).toBe(draft.claimVersion + 1);
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			...scope,
			queuedMessageId: draft._id,
			claimVersion: draft.claimVersion,
			message: queuedMessageInput("first", "Stale"),
		}),
	).rejects.toThrow("cannot be edited");
	await expect(
		asOwner.mutation(api.assistantQueuedMessageEditing.cancel, {
			...scope,
			queuedMessageId: draft._id,
			claimVersion: draft.claimVersion,
		}),
	).rejects.toThrow("cannot be edited");
	await asOwner.mutation(api.assistantQueuedMessageEditing.cancel, {
		...scope,
		queuedMessageId: latest._id,
		claimVersion: latest.claimVersion,
	});
	expect(
		(
			await asOwner.query(api.assistantQueuedMessages.listQueuedForChat, scope)
		).map((row) => row._id),
	).toEqual(rows.map((row) => row._id));
});

test("stop leaves the edit non-executable and cancel restores it paused", async () => {
	const { asOwner, scope, run, draft, t } = await editingFixture();
	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	await asOwner.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	expect(await t.run((ctx) => ctx.db.get(draft._id))).toMatchObject({
		status: "editing",
		editOrigin: { status: "paused", pauseReason: "interrupted" },
	});
	await asOwner.mutation(api.assistantQueuedMessageEditing.cancel, {
		...scope,
		queuedMessageId: draft._id,
		claimVersion: draft.claimVersion,
	});
	expect(
		(
			await asOwner.query(api.assistantQueuedMessages.listQueuedForChat, scope)
		)[0],
	).toMatchObject({
		_id: draft._id,
		status: "paused",
		pauseReason: "interrupted",
	});
});

test("stale row actions and another owner cannot mutate a checked-out draft", async () => {
	const { asOwner, scope, draft, t } = await editingFixture();
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			...scope,
			queuedMessageId: draft._id,
		}),
	).rejects.toThrow();
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			...scope,
			queuedMessageIds: [draft._id],
		}),
	).rejects.toThrow();
	const other = t.withIdentity({
		subject: "other",
		issuer: "https://graneri.test",
		tokenIdentifier: "test|other",
	});
	await expect(
		other.mutation(api.assistantQueuedMessageEditing.cancel, {
			...scope,
			queuedMessageId: draft._id,
			claimVersion: draft.claimVersion,
		}),
	).rejects.toThrow();
	await expect(
		other.query(api.assistantQueuedMessageEditing.get, scope),
	).rejects.toThrow("Workspace not found");
	expect(
		await asOwner.query(api.assistantQueuedMessageEditing.get, scope),
	).toEqual(draft);
});
