export type NoteDocument = {
	title: string;
	content: string;
	searchableText: string;
};

export type StoredNoteDocumentDraft = NoteDocument & {
	updatedAt: number;
};

export type RemoteNoteDocument<TNoteId> = NoteDocument & {
	id: TNoteId;
	updatedAt: number;
};

type NoteDocumentContext<TWorkspaceId, TNoteId> = {
	workspaceId: TWorkspaceId | null;
	noteId: TNoteId | null;
	remote: RemoteNoteDocument<TNoteId> | null | undefined;
};

type NoteDocumentSessionDependencies<TWorkspaceId, TNoteId> = {
	emptyDocument: NoteDocument;
	readDocument: () => NoteDocument;
	applyDocument: (document: NoteDocument) => void;
	loadDraft: (input: {
		workspaceId: TWorkspaceId;
		noteId: TNoteId;
	}) => Promise<StoredNoteDocumentDraft | null>;
	saveDraft: (input: {
		workspaceId: TWorkspaceId;
		noteId: TNoteId;
		document: NoteDocument;
	}) => Promise<void>;
	removeDraft: (noteId: TNoteId) => Promise<void>;
	saveRemote: (input: {
		workspaceId: TWorkspaceId;
		noteId: TNoteId;
		document: NoteDocument;
	}) => Promise<void>;
	onSaveError: (error: unknown) => void;
	onDraftError: (error: unknown) => void;
	now?: () => number;
	setTimer?: (
		callback: () => void,
		delayMs: number,
	) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	debounceMs?: number;
	maxDebounceMs?: number;
};

type SaveRequest<TWorkspaceId, TNoteId> = {
	workspaceId: TWorkspaceId;
	noteId: TNoteId;
	requestId: number;
	snapshot: string;
	document: NoteDocument;
};

type DocumentState<TWorkspaceId, TNoteId> = {
	workspaceId: TWorkspaceId | null;
	noteId: TNoteId;
	hydrated: boolean;
	lastSavedSnapshot: string | null;
	firstUnsavedAt: number | null;
	latestRequestId: number;
	pending: SaveRequest<TWorkspaceId, TNoteId> | null;
	queued: SaveRequest<TWorkspaceId, TNoteId> | null;
	inFlight: Promise<void> | null;
	queuedDraft: SaveRequest<TWorkspaceId, TNoteId> | null;
	draftInFlight: Promise<void> | null;
	failedSaves: Map<number, unknown>;
	timer: ReturnType<typeof setTimeout> | null;
};

const snapshotDocument = (document: NoteDocument) =>
	JSON.stringify(cloneDocument(document));

const cloneDocument = (document: NoteDocument): NoteDocument => ({
	title: document.title,
	content: document.content,
	searchableText: document.searchableText,
});

export const createNoteDocumentSession = <TWorkspaceId, TNoteId>({
	emptyDocument,
	readDocument,
	applyDocument,
	loadDraft,
	saveDraft,
	removeDraft,
	saveRemote,
	onSaveError,
	onDraftError,
	now = Date.now,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
	debounceMs = 2_000,
	maxDebounceMs = 10_000,
}: NoteDocumentSessionDependencies<TWorkspaceId, TNoteId>) => {
	const documents = new Map<TNoteId, DocumentState<TWorkspaceId, TNoteId>>();
	let currentNoteId: TNoteId | null = null;
	let contextVersion = 0;

	const getState = (noteId: TNoteId) => documents.get(noteId) ?? null;
	const removeDraftSafely = async (noteId: TNoteId) => {
		try {
			await removeDraft(noteId);
		} catch (error) {
			onDraftError(error);
		}
	};

	const clearSaveTimer = (state: DocumentState<TWorkspaceId, TNoteId>) => {
		if (state.timer === null) {
			return;
		}

		clearTimer(state.timer);
		state.timer = null;
	};

	const ensureState = (noteId: TNoteId, workspaceId: TWorkspaceId | null) => {
		const existing = getState(noteId);
		if (existing) {
			existing.workspaceId = workspaceId;
			return existing;
		}

		const state: DocumentState<TWorkspaceId, TNoteId> = {
			workspaceId,
			noteId,
			hydrated: false,
			lastSavedSnapshot: null,
			firstUnsavedAt: null,
			latestRequestId: 0,
			pending: null,
			queued: null,
			inFlight: null,
			queuedDraft: null,
			draftInFlight: null,
			failedSaves: new Map(),
			timer: null,
		};
		documents.set(noteId, state);
		return state;
	};

	const persistDraft = (
		state: DocumentState<TWorkspaceId, TNoteId>,
		request: SaveRequest<TWorkspaceId, TNoteId>,
	): Promise<void> => {
		if (state.draftInFlight) {
			state.queuedDraft = request;
			return state.draftInFlight;
		}

		const persistence = saveDraft({
			workspaceId: request.workspaceId,
			noteId: request.noteId,
			document: request.document,
		})
			.catch(onDraftError)
			.finally(async () => {
				state.draftInFlight = null;
				const queuedDraft = state.queuedDraft;
				state.queuedDraft = null;
				if (queuedDraft && queuedDraft.requestId === state.latestRequestId) {
					await persistDraft(state, queuedDraft);
				}
			});

		state.draftInFlight = persistence;
		return persistence;
	};

	const flushRequest = async (
		state: DocumentState<TWorkspaceId, TNoteId>,
		request: SaveRequest<TWorkspaceId, TNoteId>,
	): Promise<void> => {
		if (request.requestId !== state.latestRequestId) {
			return;
		}

		if (state.inFlight) {
			state.queued = request;
			return state.inFlight;
		}

		state.pending = null;
		clearSaveTimer(state);

		const save = (async () => {
			try {
				await saveRemote({
					workspaceId: request.workspaceId,
					noteId: request.noteId,
					document: request.document,
				});
				state.failedSaves.delete(request.requestId);
				state.lastSavedSnapshot = request.snapshot;
				if (request.requestId === state.latestRequestId) {
					state.firstUnsavedAt = null;
					state.queuedDraft = null;
					await state.draftInFlight;
					await removeDraftSafely(request.noteId);
				}
			} catch (error) {
				state.failedSaves.set(request.requestId, error);
				if (request.requestId === state.latestRequestId) {
					state.pending = request;
				}
				onSaveError(error);
			} finally {
				state.inFlight = null;
				const queued = state.queued;
				state.queued = null;

				if (
					queued &&
					queued.requestId === state.latestRequestId &&
					queued.snapshot !== state.lastSavedSnapshot
				) {
					await flushRequest(state, queued);
				}
			}
		})();

		state.inFlight = save;
		return save;
	};

	const createSaveRequest = (
		state: DocumentState<TWorkspaceId, TNoteId>,
		document: NoteDocument,
	) => {
		if (state.workspaceId === null) {
			return null;
		}

		state.latestRequestId += 1;
		return {
			workspaceId: state.workspaceId,
			noteId: state.noteId,
			requestId: state.latestRequestId,
			snapshot: snapshotDocument(document),
			document: cloneDocument(document),
		};
	};

	const scheduleSave = (
		state: DocumentState<TWorkspaceId, TNoteId>,
		document: NoteDocument,
	) => {
		const snapshot = snapshotDocument(document);
		clearSaveTimer(state);

		if (snapshot === state.lastSavedSnapshot) {
			state.firstUnsavedAt = null;
			state.pending = null;
			return;
		}

		const request = createSaveRequest(state, document);
		if (!request) {
			return;
		}

		const currentTime = now();
		state.firstUnsavedAt ??= currentTime;
		state.pending = request;
		void persistDraft(state, request);

		const remainingMaxDebounceMs = Math.max(
			0,
			maxDebounceMs - (currentTime - state.firstUnsavedAt),
		);
		state.timer = setTimer(
			() => {
				state.timer = null;
				void flushRequest(state, request);
			},
			Math.min(debounceMs, remainingMaxDebounceMs),
		);
	};

	const synchronize = async ({
		workspaceId,
		noteId,
		remote,
	}: NoteDocumentContext<TWorkspaceId, TNoteId>) => {
		const version = ++contextVersion;
		const previousNoteId = currentNoteId;

		if (previousNoteId !== noteId) {
			if (previousNoteId !== null) {
				const previousState = getState(previousNoteId);
				if (previousState) {
					previousState.hydrated = false;
				}
				void flushDocument(previousNoteId).finally(() => {
					const settledState = getState(previousNoteId);
					if (
						currentNoteId !== previousNoteId &&
						settledState?.pending === null &&
						settledState.inFlight === null &&
						settledState.draftInFlight === null
					) {
						documents.delete(previousNoteId);
					}
				});
			}
			currentNoteId = noteId;
			applyDocument(emptyDocument);
		}

		if (noteId === null) {
			return;
		}

		const state = ensureState(noteId, workspaceId);
		if (remote === undefined) {
			return;
		}

		if (state.hydrated) {
			if (!remote) {
				return;
			}

			const remoteSnapshot = snapshotDocument(remote);
			const localSnapshot = snapshotDocument(readDocument());
			if (
				remoteSnapshot !== state.lastSavedSnapshot &&
				localSnapshot === state.lastSavedSnapshot &&
				state.pending === null &&
				state.inFlight === null
			) {
				state.lastSavedSnapshot = remoteSnapshot;
				await removeDraftSafely(noteId);
				if (version === contextVersion && currentNoteId === noteId) {
					applyDocument(cloneDocument(remote));
				}
			}
			return;
		}

		let localDraft: StoredNoteDocumentDraft | null = null;
		if (remote && workspaceId !== null) {
			localDraft = await loadDraft({ workspaceId, noteId });
		}

		if (version !== contextVersion || currentNoteId !== noteId) {
			return;
		}

		if (remote) {
			if (localDraft && localDraft.updatedAt <= remote.updatedAt) {
				void removeDraftSafely(noteId);
			}
			state.lastSavedSnapshot = snapshotDocument(remote);
			applyDocument(
				cloneDocument(
					localDraft && localDraft.updatedAt > remote.updatedAt
						? localDraft
						: remote,
				),
			);
		} else {
			state.lastSavedSnapshot = snapshotDocument(emptyDocument);
			applyDocument(emptyDocument);
		}

		state.hydrated = true;
	};

	const update = (document: NoteDocument) => {
		if (currentNoteId === null) {
			return;
		}

		const state = getState(currentNoteId);
		if (!state?.hydrated) {
			return;
		}

		scheduleSave(state, document);
	};

	async function flushDocument(noteId: TNoteId | null = currentNoteId) {
		if (noteId === null) {
			return;
		}

		const state = getState(noteId);
		if (!state) {
			return;
		}

		clearSaveTimer(state);
		const pending = state.pending;
		if (pending) {
			await flushRequest(state, pending);
		}

		await state.inFlight;
	}

	const saveNow = async (document: NoteDocument) => {
		if (currentNoteId === null) {
			throw new Error("Cannot save a note document without an active note.");
		}

		const state = getState(currentNoteId);
		if (!state?.hydrated) {
			throw new Error(
				"Cannot save a note document before hydration completes.",
			);
		}

		clearSaveTimer(state);
		const request = createSaveRequest(state, document);
		if (!request) {
			throw new Error(
				"Cannot save a note document without an active workspace.",
			);
		}

		state.pending = request;
		await flushRequest(state, request);
		const saveError = state.failedSaves.get(request.requestId);
		state.failedSaves.delete(request.requestId);
		if (saveError) {
			throw saveError;
		}
	};

	const dispose = () => {
		contextVersion += 1;
		for (const state of documents.values()) {
			clearSaveTimer(state);
			if (state.pending) {
				void flushRequest(state, state.pending);
			}
		}
	};

	return {
		dispose,
		flush: () => flushDocument(),
		saveNow,
		synchronize,
		update,
	};
};
