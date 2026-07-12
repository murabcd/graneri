import { describe, expect, it, vi } from "vitest";
import {
	createNoteDocumentSession,
	type NoteDocument,
	type StoredNoteDocumentDraft,
} from "../src/lib/note-document-session";

const emptyDocument: NoteDocument = {
	title: "",
	content: '{"type":"doc","content":[]}',
	searchableText: "",
};

const document = (title: string): NoteDocument => ({
	title,
	content: JSON.stringify({ type: "doc", title }),
	searchableText: title,
});

const remoteDocument = (id: string, title: string, updatedAt: number) => ({
	id,
	updatedAt,
	...document(title),
});

const deferred = <T>() => {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
};

const createHarness = ({
	drafts = new Map<string, StoredNoteDocumentDraft>(),
	loadDraft,
	saveDraft,
	saveRemote,
}: {
	drafts?: Map<string, StoredNoteDocumentDraft>;
	loadDraft?: (noteId: string) => Promise<StoredNoteDocumentDraft | null>;
	saveDraft?: (input: {
		noteId: string;
		document: NoteDocument;
	}) => Promise<void>;
	saveRemote?: (input: {
		workspaceId: string;
		noteId: string;
		document: NoteDocument;
	}) => Promise<void>;
} = {}) => {
	let currentDocument = emptyDocument;
	let currentTime = 0;
	let nextTimerId = 1;
	const timers = new Map<number, { callback: () => void; delayMs: number }>();
	const applied: NoteDocument[] = [];
	const removedDrafts: string[] = [];
	const savedDrafts: Array<{ noteId: string; document: NoteDocument }> = [];
	const remoteSaves: Array<{ noteId: string; document: NoteDocument }> = [];
	const saveErrors: unknown[] = [];

	const session = createNoteDocumentSession<string, string>({
		emptyDocument,
		readDocument: () => currentDocument,
		applyDocument: (nextDocument) => {
			currentDocument = nextDocument;
			applied.push(nextDocument);
		},
		loadDraft: ({ noteId }) =>
			loadDraft
				? loadDraft(noteId)
				: Promise.resolve(drafts.get(noteId) ?? null),
		saveDraft: async ({ noteId, document: nextDocument }) => {
			savedDrafts.push({ noteId, document: nextDocument });
			await saveDraft?.({ noteId, document: nextDocument });
		},
		removeDraft: async (noteId) => {
			removedDrafts.push(noteId);
		},
		saveRemote: async (input) => {
			remoteSaves.push({ noteId: input.noteId, document: input.document });
			await saveRemote?.(input);
		},
		onSaveError: (error) => saveErrors.push(error),
		onDraftError: (error) => saveErrors.push(error),
		now: () => currentTime,
		setTimer: (callback, delayMs) => {
			const timerId = nextTimerId;
			nextTimerId += 1;
			timers.set(timerId, { callback, delayMs });
			return timerId;
		},
		clearTimer: (timerId) => {
			timers.delete(Number(timerId));
		},
	});

	return {
		applied,
		removedDrafts,
		remoteSaves,
		saveErrors,
		savedDrafts,
		session,
		timers,
		setCurrentDocument(nextDocument: NoteDocument) {
			currentDocument = nextDocument;
		},
		setCurrentTime(value: number) {
			currentTime = value;
		},
	};
};

describe("note document session", () => {
	it("hydrates from a newer local draft and removes a stale draft", async () => {
		const drafts = new Map<string, StoredNoteDocumentDraft>([
			["newer", { ...document("local draft"), updatedAt: 20 }],
			["stale", { ...document("old draft"), updatedAt: 5 }],
		]);
		const harness = createHarness({ drafts });

		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "newer",
			remote: remoteDocument("newer", "remote", 10),
		});
		expect(harness.applied.at(-1)).toEqual(document("local draft"));

		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "stale",
			remote: remoteDocument("stale", "remote wins", 10),
		});
		expect(harness.applied.at(-1)).toEqual(document("remote wins"));
		expect(harness.removedDrafts).toContain("stale");
	});

	it("applies remote changes only while the local document is clean", async () => {
		const harness = createHarness();
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "first", 1),
		});

		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "remote update", 2),
		});
		expect(harness.applied.at(-1)?.title).toBe("remote update");

		const localEdit = document("local edit");
		harness.setCurrentDocument(localEdit);
		harness.session.update(localEdit);
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "stale remote render", 3),
		});
		expect(harness.applied.at(-1)?.title).toBe("remote update");
	});

	it("keeps the maximum debounce anchored to the first unsaved edit", async () => {
		const harness = createHarness();
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "saved", 1),
		});

		harness.setCurrentDocument(document("first edit"));
		harness.session.update(document("first edit"));
		expect([...harness.timers.values()][0]?.delayMs).toBe(2_000);

		harness.setCurrentTime(9_500);
		harness.setCurrentDocument(document("latest edit"));
		harness.session.update(document("latest edit"));
		expect([...harness.timers.values()][0]?.delayMs).toBe(500);
		await vi.waitFor(() => expect(harness.savedDrafts).toHaveLength(2));
		expect(harness.savedDrafts.map(({ document }) => document.title)).toEqual([
			"first edit",
			"latest edit",
		]);
	});

	it("serializes local draft writes so an older write cannot finish last", async () => {
		const firstDraftSave = deferred<void>();
		const saveDraft = vi
			.fn<
				(input: { noteId: string; document: NoteDocument }) => Promise<void>
			>()
			.mockImplementationOnce(() => firstDraftSave.promise)
			.mockResolvedValue(undefined);
		const harness = createHarness({ saveDraft });
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "saved", 1),
		});

		harness.setCurrentDocument(document("first edit"));
		harness.session.update(document("first edit"));
		harness.setCurrentDocument(document("latest edit"));
		harness.session.update(document("latest edit"));
		expect(saveDraft).toHaveBeenCalledTimes(1);

		firstDraftSave.resolve();
		await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
		expect(saveDraft.mock.calls.map(([input]) => input.document.title)).toEqual(
			["first edit", "latest edit"],
		);
	});

	it("serializes saves per note and flushes only the latest queued document", async () => {
		const firstSave = deferred<void>();
		const saveRemote = vi
			.fn<
				(input: {
					workspaceId: string;
					noteId: string;
					document: NoteDocument;
				}) => Promise<void>
			>()
			.mockImplementationOnce(() => firstSave.promise)
			.mockResolvedValue(undefined);
		const harness = createHarness({ saveRemote });
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "saved", 1),
		});

		const firstFlush = harness.session.saveNow(document("first edit"));
		await vi.waitFor(() => expect(saveRemote).toHaveBeenCalledTimes(1));
		harness.setCurrentDocument(document("second edit"));
		harness.session.update(document("second edit"));
		const secondFlush = harness.session.flush();
		harness.setCurrentDocument(document("latest edit"));
		harness.session.update(document("latest edit"));
		const latestFlush = harness.session.flush();

		firstSave.resolve();
		await Promise.all([firstFlush, secondFlush, latestFlush]);
		expect(saveRemote).toHaveBeenCalledTimes(2);
		expect(
			saveRemote.mock.calls.map(([input]) => input.document.title),
		).toEqual(["first edit", "latest edit"]);
	});

	it("keeps save identity correct when switching notes during an in-flight save", async () => {
		const firstSave = deferred<void>();
		const harness = createHarness({
			saveRemote: ({ noteId }) =>
				noteId === "first" ? firstSave.promise : Promise.resolve(),
		});
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "first",
			remote: remoteDocument("first", "first saved", 1),
		});
		const firstFlush = harness.session.saveNow(document("first edit"));

		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "second",
			remote: remoteDocument("second", "second saved", 1),
		});
		harness.setCurrentDocument(document("second edit"));
		harness.session.update(document("second edit"));
		await harness.session.flush();

		expect(harness.remoteSaves.map(({ noteId }) => noteId)).toEqual([
			"first",
			"second",
		]);
		firstSave.resolve();
		await firstFlush;
	});

	it("keeps a failed remote save pending for an explicit retry", async () => {
		const saveFailure = new Error("offline");
		const saveRemote = vi
			.fn<
				(input: {
					workspaceId: string;
					noteId: string;
					document: NoteDocument;
				}) => Promise<void>
			>()
			.mockRejectedValueOnce(saveFailure)
			.mockResolvedValue(undefined);
		const harness = createHarness({ saveRemote });
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "note",
			remote: remoteDocument("note", "saved", 1),
		});

		await expect(harness.session.saveNow(document("recover me"))).rejects.toBe(
			saveFailure,
		);
		expect(harness.saveErrors).toEqual([saveFailure]);
		await harness.session.flush();

		expect(saveRemote).toHaveBeenCalledTimes(2);
		expect(harness.removedDrafts).toEqual(["note"]);
	});

	it("ignores late hydration after navigation moves to another note", async () => {
		const firstDraft = deferred<StoredNoteDocumentDraft | null>();
		const harness = createHarness({
			loadDraft: (noteId) =>
				noteId === "first" ? firstDraft.promise : Promise.resolve(null),
		});
		const firstSync = harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "first",
			remote: remoteDocument("first", "first", 1),
		});
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "second",
			remote: remoteDocument("second", "second", 1),
		});

		firstDraft.resolve({ ...document("late first draft"), updatedAt: 2 });
		await firstSync;
		expect(harness.applied.at(-1)?.title).toBe("second");
	});

	it("rehydrates a note when navigation returns to it", async () => {
		const harness = createHarness();
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "first",
			remote: remoteDocument("first", "first", 1),
		});
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "second",
			remote: remoteDocument("second", "second", 1),
		});
		await harness.session.synchronize({
			workspaceId: "workspace",
			noteId: "first",
			remote: remoteDocument("first", "first again", 2),
		});

		expect(harness.applied.at(-1)?.title).toBe("first again");
	});
});
